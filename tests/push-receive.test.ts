import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { loadSfConfig, resolveSecrets, type SfConfig } from "../app/sf/config";
import {
  CONFIRMED_CARGO_OWNER_CODE,
  CONFIRMED_WAREHOUSE_CODE,
  OUTBOUND_STATUS_PUSH_PATH,
  REJECTED_CARGO_OWNER_CODE,
  SERVICE_CODES,
} from "../app/sf/constants";
import { dataDigest } from "../app/sf/sign";
import {
  handleOutboundStatusPush,
  pushMethodNotAllowedResponse,
} from "../app/sf/receive-push";
import { TRACKING_INFO_UPDATE } from "../app/shopify/operations";
import type { AdminGraphqlClient } from "../app/shopify/apply-tracking";
import type { ShopifyOrderSnapshot } from "../app/shopify/tracking-plan";

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

function config(overrides: NodeJS.ProcessEnv = {}): SfConfig {
  return loadSfConfig({
    SF_ISSUED_ACCESS_CODE: "test-access",
    SF_ISSUED_PASS_CODE: "test-pass",
    SF_ISSUED_MD5_CHECKWORD: "test-md5-special",
    SF_LIVE_CALLS_ENABLED: "false",
    SHOPIFY_TRACKING_WRITES_ENABLED: "false",
    ...overrides,
  });
}

function signedBody(plaintext: string, special = "test-md5-special"): string {
  return new URLSearchParams({
    logistics_interface: plaintext,
    data_digest: dataDigest(plaintext, special),
  }).toString();
}

function pushXml(options?: { checkword?: string; company?: string; warehouse?: string; waybill?: string }): string {
  const checkword = options?.checkword ?? "test-pass";
  const company = options?.company ?? CONFIRMED_CARGO_OWNER_CODE;
  const warehouse = options?.warehouse ?? CONFIRMED_WAREHOUSE_CODE;
  const waybill = options?.waybill ?? "SF1001";
  return (
    `<Request service="${SERVICE_CODES.outboundStatusPush}" lang="zh-CN">` +
    `<Head><AccessCode>test-access</AccessCode><Checkword>${checkword}</Checkword></Head>` +
    `<Body><SaleOrderStatusRequest><CompanyCode>${company}</CompanyCode><SaleOrders><SaleOrder>` +
    `<WarehouseCode>${warehouse}</WarehouseCode><ErpOrder>1001</ErpOrder><WayBillNo>${waybill}</WayBillNo><IsSplit>N</IsSplit>` +
    `</SaleOrder></SaleOrders></SaleOrderStatusRequest></Body></Request>`
  );
}

function adminRecording(order: ShopifyOrderSnapshot | null = paidOrder): {
  admin: AdminGraphqlClient;
  calls: Array<{ query: string; variables?: Record<string, unknown> }>;
} {
  const calls: Array<{ query: string; variables?: Record<string, unknown> }> = [];
  return {
    calls,
    admin: {
      graphql: async (query, options) => {
        calls.push({ query, variables: options?.variables });
        if (query.includes("fulfillmentTrackingInfoUpdate")) {
          return { json: async () => ({ data: { fulfillmentTrackingInfoUpdate: { userErrors: [] } } }) };
        }
        return { json: async () => ({ data: { orders: { nodes: order ? [order] : [] } } }) };
      },
    },
  };
}

async function postPush(
  rawBody: string,
  options?: {
    contentType?: string | null;
    sysSource?: string | null;
    serviceCode?: string | null;
    admin?: AdminGraphqlClient | null;
    env?: NodeJS.ProcessEnv;
  },
) {
  return handleOutboundStatusPush({
    config: config(options?.env),
    contentType: options && "contentType" in options ? options.contentType ?? null : "application/x-www-form-urlencoded",
    headers: {
      sysSource: options && "sysSource" in options ? options.sysSource ?? null : CONFIRMED_CARGO_OWNER_CODE,
      serviceCode: options && "serviceCode" in options ? options.serviceCode ?? null : SERVICE_CODES.outboundStatusPush,
    },
    rawBody,
    admin: options && "admin" in options ? options.admin ?? null : adminRecording().admin,
  });
}

describe("3.15 outbound status push", () => {
  it("uses the app path and does not name a public hostname", async () => {
    assert.equal(OUTBOUND_STATUS_PUSH_PATH, "/api/sf/outbound-status");
    const response = pushMethodNotAllowedResponse();
    assert.equal(response.status, 405);
    const text = await response.text();
    assert.match(text, /POST \/api\/sf\/outbound-status/);
    assert.equal(text.includes("https://"), false);
  });

  it("verifies the digest and Check Word, then updates tracking without calling SF", async () => {
    const recorded = adminRecording();
    const plaintext = pushXml();
    const response = await handleOutboundStatusPush({
      config: config(),
      contentType: "application/x-www-form-urlencoded; charset=utf-8",
      headers: {
        sysSource: CONFIRMED_CARGO_OWNER_CODE,
        serviceCode: SERVICE_CODES.outboundStatusPush,
      },
      rawBody: signedBody(plaintext),
      admin: recorded.admin,
    });
    const body = await response.text();
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /application\/xml/);
    assert.match(body, /<Head>OK<\/Head>/);
    assert.match(body, /<Result>1<\/Result>/);
    assert.equal(body.includes("test-access"), false);
    assert.equal(body.includes("test-pass"), false);
    assert.equal(body.includes("test-md5-special"), false);
    assert.equal(recorded.calls.some((call) => call.query.includes("fulfillmentTrackingInfoUpdate")), true);
    assert.equal(recorded.calls.some((call) => call.query.includes("fulfillmentCreate")), false);
    const update = recorded.calls.find((call) => call.query === TRACKING_INFO_UPDATE);
    assert.equal(update?.variables?.trackingInfoInput && (update.variables.trackingInfoInput as { number: string }).number, "SF1001");
    assert.equal(resolveSecrets(config())?.md5SpecialString, "test-md5-special");
  });

  it("rejects a digest that does not match and does not touch Shopify", async () => {
    const recorded = adminRecording();
    const response = await handleOutboundStatusPush({
      config: config(),
      contentType: "application/x-www-form-urlencoded",
      headers: {
        sysSource: CONFIRMED_CARGO_OWNER_CODE,
        serviceCode: SERVICE_CODES.outboundStatusPush,
      },
      rawBody: new URLSearchParams({
        logistics_interface: pushXml(),
        data_digest: dataDigest("<order></order>", "other-special"),
      }).toString(),
      admin: recorded.admin,
    });
    const body = await response.text();
    assert.match(body, /<Head>ERR<\/Head>/);
    assert.match(body, /data_digest does not match/);
    assert.equal(recorded.calls.length, 0);
  });

  it("rejects a Check Word that does not match even when the digest is valid", async () => {
    const recorded = adminRecording();
    const plaintext = pushXml({ checkword: "wrong-check-word" });
    const response = await handleOutboundStatusPush({
      config: config(),
      contentType: "application/x-www-form-urlencoded",
      headers: {
        sysSource: CONFIRMED_CARGO_OWNER_CODE,
        serviceCode: SERVICE_CODES.outboundStatusPush,
      },
      rawBody: signedBody(plaintext),
      admin: recorded.admin,
    });
    const body = await response.text();
    assert.match(body, /<Head>ERR<\/Head>/);
    assert.match(body, /Check Word does not match/);
    assert.equal(body.includes("wrong-check-word"), false);
    assert.equal(recorded.calls.length, 0);
  });

  it("rejects the wrong content type, sysSource, and serviceCode", async () => {
    const body = signedBody(pushXml());
    const wrongType = await postPush(body, { contentType: "application/xml", admin: adminRecording().admin });
    assert.match(await wrongType.text(), /Content-Type must be application\/x-www-form-urlencoded/);
    const wrongSource = await postPush(body, { sysSource: REJECTED_CARGO_OWNER_CODE, admin: adminRecording().admin });
    assert.match(await wrongSource.text(), /sysSource does not match/);
    const wrongService = await postPush(body, { serviceCode: "ITEM_SERVICE", admin: adminRecording().admin });
    assert.match(await wrongService.text(), /serviceCode must be SALE_ORDER_STATUS_PUSH_SERVICE/);
  });

  it("does not acknowledge success when Shopify is not installed", async () => {
    const response = await postPush(signedBody(pushXml()), { admin: null });
    const body = await response.text();
    assert.match(body, /<Head>ERR<\/Head>/);
    assert.match(body, /not installed/);
    assert.equal(body.includes("<Result>1</Result>"), false);
  });

  it("does not create a fulfillment for an unpaid order", async () => {
    const recorded = adminRecording({ ...paidOrder, displayFinancialStatus: "PENDING" });
    const response = await handleOutboundStatusPush({
      config: config(),
      contentType: "application/x-www-form-urlencoded",
      headers: {
        sysSource: CONFIRMED_CARGO_OWNER_CODE,
        serviceCode: SERVICE_CODES.outboundStatusPush,
      },
      rawBody: signedBody(pushXml()),
      admin: recorded.admin,
    });
    const body = await response.text();
    assert.match(body, /<Head>PART<\/Head>/);
    assert.match(body, /<Result>2<\/Result>/);
    assert.equal(recorded.calls.some((call) => call.query.includes("fulfillmentTrackingInfoUpdate")), false);
  });

  it("rejects a warehouse other than 852DCTZ", async () => {
    const recorded = adminRecording();
    const response = await handleOutboundStatusPush({
      config: config(),
      contentType: "application/x-www-form-urlencoded",
      headers: {
        sysSource: CONFIRMED_CARGO_OWNER_CODE,
        serviceCode: SERVICE_CODES.outboundStatusPush,
      },
      rawBody: signedBody(pushXml({ warehouse: "571DCF" })),
      admin: recorded.admin,
    });
    assert.match(await response.text(), /WarehouseCode must be 852DCTZ/);
    assert.equal(recorded.calls.length, 0);
  });

  it("returns the 3.15 JSON success shape", async () => {
    const plaintext = JSON.stringify({
      ServiceCode: SERVICE_CODES.outboundStatusPush,
      AccessCode: "test-access",
      Checkword: "test-pass",
      CompanyCode: CONFIRMED_CARGO_OWNER_CODE,
      SaleOrders: [
        {
          WarehouseCode: CONFIRMED_WAREHOUSE_CODE,
          ErpOrder: "1001",
          WayBillNo: "SF1001",
          IsSplit: "N",
        },
      ],
    });
    const recorded = adminRecording();
    const response = await handleOutboundStatusPush({
      config: config(),
      contentType: "application/x-www-form-urlencoded",
      headers: {
        sysSource: CONFIRMED_CARGO_OWNER_CODE,
        serviceCode: SERVICE_CODES.outboundStatusPush,
      },
      rawBody: signedBody(plaintext),
      admin: recorded.admin,
    });
    const body = await response.json() as { result: string; message: string; data: null };
    assert.equal(body.result, "1");
    assert.equal(body.message, "SUCCESS");
    assert.equal(body.data, null);
    assert.equal(recorded.calls.some((call) => call.query.includes("fulfillmentTrackingInfoUpdate")), true);
  });

  it("keeps the route off the Shopify admin session", () => {
    const source = readFileSync(new URL("../app/routes/api.sf.outbound-status.tsx", import.meta.url), "utf8");
    assert.equal(source.includes("authenticate.admin("), false);
    assert.match(source, /unauthenticated\.admin\(/);
    assert.equal(source.includes("liveCallsEnabled"), false);
  });
});
