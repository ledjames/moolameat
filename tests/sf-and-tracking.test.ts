import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { sendPreparedRequest, SfLiveCallsDisabledError, prepareStatusQuery } from "../app/sf/client";
import { loadSfConfig, queryGate, resolveRequestUrl, unconfirmedProductionGuesses } from "../app/sf/config";
import { CONFIRMED_CARGO_OWNER_CODE, CONFIRMED_WAREHOUSE_CODE, REJECTED_CARGO_OWNER_CODE, SIT_REQUEST_URL } from "../app/sf/constants";
import { dataDigest } from "../app/sf/sign";
import { parseStatusDocument } from "../app/sf/parse-status";
import { runStatusQuery } from "../app/tracking/query-action";
import { TRACKING_INFO_UPDATE, TRACKING_ORDER_QUERY } from "../app/shopify/operations";
import { buildTrackingPlan } from "../app/shopify/tracking-plan";
import type { ShopifyOrderSnapshot } from "../app/shopify/tracking-plan";
import { applyTrackingPlan } from "../app/shopify/apply-tracking";

const SPEC_DIGEST = "MmUwODUzOTA0OWFjMGY2YjViNDM3N2VjMjAxNDVjMDY=";

function configuredEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    SF_ISSUED_ACCESS_CODE: "test-access",
    SF_ISSUED_PASS_CODE: "test-pass",
    SF_ISSUED_MD5_CHECKWORD: "test-md5-special",
    SF_ENVIRONMENT: "sit",
    SF_LIVE_CALLS_ENABLED: "false",
    SHOPIFY_TRACKING_WRITES_ENABLED: "false",
    ...overrides,
  };
}

describe("signing", () => {
  it("matches the spec worked example of hex digest then Base64", () => {
    assert.equal(dataDigest("<order></order>", "123456"), SPEC_DIGEST);
  });

  it("does not Base64-encode the raw MD5 bytes", () => {
    const raw = Buffer.from(createHash("md5").update("<order></order>123456").digest()).toString("base64");
    assert.notEqual(raw, SPEC_DIGEST);
  });
});

describe("request URL", () => {
  it("uses the documented SIT URL and leaves production unset", () => {
    const config = loadSfConfig(configuredEnv());
    const url = resolveRequestUrl(config);
    assert.equal(url.ok && url.url, SIT_REQUEST_URL);
    assert.equal(config.productionRequestUrl, "");
    assert.equal(config.productionGatewayHost, "https://portal-gateway.sf-express.com");
  });

  it("refuses production URLs guessed from the SIT URL", () => {
    for (const guess of unconfirmedProductionGuesses()) {
      const config = loadSfConfig(configuredEnv({ SF_ENVIRONMENT: "production", SF_PRODUCTION_REQUEST_URL: guess }));
      const url = resolveRequestUrl(config);
      assert.equal(url.ok, false);
    }
    const hostOnly = loadSfConfig(
      configuredEnv({
        SF_ENVIRONMENT: "production",
        SF_PRODUCTION_REQUEST_URL: "https://portal-gateway.sf-express.com",
      }),
    );
    assert.equal(resolveRequestUrl(hostOnly).ok, false);
  });

  it("refuses the rejected cargo owner code", () => {
    const config = loadSfConfig(configuredEnv({ SF_COMPANY_CODE: REJECTED_CARGO_OWNER_CODE }));
    assert.equal(queryGate(config).enabled, false);
    assert.equal(config.rejectedCodeInUse, REJECTED_CARGO_OWNER_CODE);
    assert.equal(config.companyCode === CONFIRMED_CARGO_OWNER_CODE, false);
  });
});

describe("3.16 request", () => {
  it("signs XML with AccessCode and Checkword and does not send a PassCode field", () => {
    const config = loadSfConfig(configuredEnv());
    const prepared = prepareStatusQuery(config, { erpOrder: "1001", shipmentId: "SO1" });
    const params = new URLSearchParams(prepared.body);
    const plaintext = params.get("logistics_interface") ?? "";
    const digest = params.get("data_digest") ?? "";
    assert.equal(prepared.url, SIT_REQUEST_URL);
    assert.equal(prepared.headers.sysSource, CONFIRMED_CARGO_OWNER_CODE);
    assert.equal(prepared.headers.serviceCode, "SALE_ORDER_STATUS_QUERY_SERVICE");
    assert.equal(prepared.headers["Content-Type"], "application/x-www-form-urlencoded");
    assert.match(plaintext, /<AccessCode>test-access<\/AccessCode>/);
    assert.match(plaintext, /<Checkword>test-pass<\/Checkword>/);
    assert.equal(plaintext.includes("PassCode"), false);
    assert.match(plaintext, new RegExp(`<CompanyCode>${CONFIRMED_CARGO_OWNER_CODE}</CompanyCode>`));
    assert.match(plaintext, new RegExp(`<WarehouseCode>${CONFIRMED_WAREHOUSE_CODE}</WarehouseCode>`));
    assert.equal(digest, dataDigest(plaintext, "test-md5-special"));
    assert.equal(params.get("sysSource"), null);
  });

  it("can build the JSON shape without a PassCode field", () => {
    const config = loadSfConfig(configuredEnv({ SF_PAYLOAD_FORMAT: "json" }));
    const prepared = prepareStatusQuery(config, { erpOrder: "1001" });
    const plaintext = new URLSearchParams(prepared.body).get("logistics_interface") ?? "";
    const parsed = JSON.parse(plaintext) as Record<string, unknown>;
    assert.equal(parsed.AccessCode, "test-access");
    assert.equal(parsed.Checkword, "test-pass");
    assert.equal(parsed.ServiceCode, "SALE_ORDER_STATUS_QUERY_SERVICE");
    assert.equal(parsed.CompanyCode, CONFIRMED_CARGO_OWNER_CODE);
    assert.equal(Object.hasOwn(parsed, "PassCode"), false);
  });
});

describe("live call guard", () => {
  it("does not call fetch when live calls are disabled", async () => {
    let called = false;
    const prepared = prepareStatusQuery(loadSfConfig(configuredEnv()), { erpOrder: "1001" });
    await assert.rejects(
      () =>
        sendPreparedRequest(prepared, {
          liveCallsEnabled: false,
          fetchImpl: () => {
            called = true;
            return Promise.reject(new Error("fetch should not run"));
          },
        }),
      SfLiveCallsDisabledError,
    );
    assert.equal(called, false);
  });

  it("does not put credential values in the admin query result", async () => {
    let called = false;
    const result = await runStatusQuery({
      config: loadSfConfig(configuredEnv()),
      erpOrder: "1001",
      fetchImpl: () => {
        called = true;
        return Promise.reject(new Error("fetch should not run"));
      },
      admin: {
        graphql: () => Promise.reject(new Error("Shopify should not be called")),
      },
    });
    assert.equal(called, false);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.sent, false);
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes("test-access"), false);
    assert.equal(serialized.includes("test-pass"), false);
    assert.equal(serialized.includes("test-md5-special"), false);
  });
});

const QUERY_RESPONSE = `<?xml version="1.0" encoding="UTF-8"?>
<Response service="SALE_ORDER_STATUS_QUERY_SERVICE">
  <Head>OK</Head>
  <Body>
    <SaleOrderStatusResponse>
      <SaleOrders>
        <SaleOrder>
          <Result>1</Result>
          <ErpOrder>1001</ErpOrder>
          <Header>
            <ErpOrder>1001</ErpOrder>
            <OrderStatus>2900</OrderStatus>
            <WayBillNo>SF1001</WayBillNo>
            <Carrier>CP</Carrier>
            <ShipmentId>SO1</ShipmentId>
            <IsSplit>N</IsSplit>
          </Header>
          <Steps>
            <Step>
              <EventTime>2024-01-02 03:04:05</EventTime>
              <EventAddress>HK</EventAddress>
              <Status>2900</Status>
              <Note>Left the warehouse</Note>
            </Step>
          </Steps>
        </SaleOrder>
      </SaleOrders>
    </SaleOrderStatusResponse>
  </Body>
</Response>`;

describe("status parsing", () => {
  it("reads a 3.16 XML response", () => {
    const document = parseStatusDocument(QUERY_RESPONSE);
    assert.equal(document.head, "OK");
    assert.equal(document.orders[0]?.wayBillNo, "SF1001");
    assert.equal(document.orders[0]?.orderStatus, "2900");
    assert.equal(document.orders[0]?.steps[0]?.note, "Left the warehouse");
  });

  it("reads a 3.16 JSON response", () => {
    const document = parseStatusDocument(
      JSON.stringify({
        Head: "PART",
        SaleOrders: [{ Result: "2", ErpOrder: "1002", Note: "Order does not exist" }],
      }),
    );
    assert.equal(document.head, "PART");
    assert.equal(document.orders[0]?.result, "2");
    assert.equal(document.orders[0]?.note, "Order does not exist");
  });
});

const paidOrder: ShopifyOrderSnapshot = {
  id: "gid://shopify/Order/1",
  name: "#1001",
  displayFinancialStatus: "PAID",
  fulfillments: [
    {
      id: "gid://shopify/Fulfillment/9",
      status: "SUCCESS",
      createdAt: "2024-01-01T00:00:00Z",
      trackingInfo: [],
    },
  ],
};

describe("Shopify tracking plan", () => {
  it("updates tracking on a paid order with an existing fulfillment", () => {
    const plan = buildTrackingPlan(
      { erpOrder: "1001", wayBillNo: "SF1001", carrier: "CP", orderStatus: "2900", steps: [], isSplit: "N" },
      { status: "found", order: paidOrder },
      { notifyCustomer: false },
    );
    assert.equal(plan.action, "update_tracking");
    assert.equal(plan.mutation, "fulfillmentTrackingInfoUpdate");
    assert.equal(plan.inventoryImpact, "none");
    assert.equal(plan.trackingUrl, null);
    assert.equal(plan.shopifyCompany, "SF Express");
    assert.equal(plan.fulfillmentId, paidOrder.fulfillments[0]?.id);
    assert.equal(plan.notifyCustomer, false);
  });

  it("blocks unpaid orders, missing waybills, splits, and orders with no fulfillment", () => {
    const unpaid = buildTrackingPlan(
      { wayBillNo: "SF1", steps: [] },
      { status: "found", order: { ...paidOrder, displayFinancialStatus: "PENDING" } },
      { notifyCustomer: false },
    );
    assert.equal(unpaid.action, "blocked");
    assert.match(unpaid.blockReason ?? "", /not PAID/);

    const noWaybill = buildTrackingPlan(
      { steps: [] },
      { status: "found", order: paidOrder },
      { notifyCustomer: false },
    );
    assert.match(noWaybill.blockReason ?? "", /WayBillNo/);

    const split = buildTrackingPlan(
      { wayBillNo: "SF1", isSplit: "Y", steps: [] },
      { status: "found", order: paidOrder },
      { notifyCustomer: false },
    );
    assert.match(split.blockReason ?? "", /split/);

    const noFulfillment = buildTrackingPlan(
      { wayBillNo: "SF1", steps: [] },
      { status: "found", order: { ...paidOrder, fulfillments: [] } },
      { notifyCustomer: false },
    );
    assert.match(noFulfillment.blockReason ?? "", /fulfillmentCreate/);
    assert.equal(noFulfillment.inventoryImpact, "none");
  });

  it("does not call the tracking mutation while writes are disabled", async () => {
    const plan = buildTrackingPlan(
      { wayBillNo: "SF1001", steps: [] },
      { status: "found", order: paidOrder },
      { notifyCustomer: false },
    );
    const result = await applyTrackingPlan(
      { graphql: () => Promise.reject(new Error("mutation should not run")) },
      plan,
      false,
    );
    assert.equal(result.applied, false);
  });

  it("reads the order and does not update tracking when a mocked SF response arrives", async () => {
    const calls: string[] = [];
    const result = await runStatusQuery({
      config: loadSfConfig(configuredEnv({ SF_LIVE_CALLS_ENABLED: "true" })),
      erpOrder: "1001",
      fetchImpl: async (input) => {
        assert.equal(String(input), SIT_REQUEST_URL);
        return new Response(QUERY_RESPONSE, { status: 200 });
      },
      admin: {
        graphql: async (query) => {
          calls.push(query);
          return {
            json: async () => ({ data: { orders: { nodes: [paidOrder] } } }),
          };
        },
      },
    });
    assert.equal(result.ok && result.sent, true);
    if (result.ok && result.sent) {
      assert.equal(result.orders[0]?.wayBillNo, "SF1001");
      assert.equal(result.plan?.action, "update_tracking");
      assert.equal(result.shopifyWrite.applied, false);
      assert.equal(JSON.stringify(result).includes("test-access"), false);
    }
    assert.equal(calls.length, 1);
    assert.match(calls[0] ?? "", /TrackingOrderBySearch/);
    assert.equal(calls.some((query) => query.includes("fulfillmentTrackingInfoUpdate")), false);
  });
});

describe("Shopify operations", () => {
  it("only updates tracking info", () => {
    const source = readFileSync(new URL("../app/shopify/operations.ts", import.meta.url), "utf8");
    assert.match(TRACKING_ORDER_QUERY, /displayFinancialStatus/);
    assert.match(TRACKING_INFO_UPDATE, /fulfillmentTrackingInfoUpdate/);
    assert.equal(source.includes("fulfillmentCreate"), false);
    assert.equal(source.includes("inventoryAdjust"), false);
    assert.equal(source.includes("productCreate"), false);
    assert.equal(source.includes("productUpdate"), false);
  });
});
