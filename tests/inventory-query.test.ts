import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { compareInventory } from "../app/inventory/compare";
import { runInventoryPreview } from "../app/inventory/preview";
import { prepareInventoryQuery } from "../app/sf/client";
import { loadSfConfig } from "../app/sf/config";
import {
  CONFIRMED_CARGO_OWNER_CODE,
  CONFIRMED_WAREHOUSE_CODE,
  INVENTORY_STATUS_GOOD,
  SIT_REQUEST_URL,
} from "../app/sf/constants";
import { parseInventoryDocument } from "../app/sf/inventory";
import { dataDigest } from "../app/sf/sign";
import type { AdminGraphqlClient } from "../app/shopify/apply-tracking";

/**
 * Response body from spec 3.18.5. The request sample's Access Code and Check Word
 * are not copied here.
 */
const SPEC_JSON_OK = `{
  "Head": "OK",
  "RTInventorys": [
    {
      "Result": "1",
      "Note": "",
      "Header": {
        "SkuNo": "SKU_test_1",
        "Lot": "",
        "InventoryStatus": "10",
        "TotalQty": 2068,
        "OnHandQty": 1992,
        "AvailableQty": 1775,
        "InTransitQty": 76,
        "MfgDate": "2023-10-01 00:00:00",
        "RecDate": "2023-10-01 00:00:00"
      }
    },
    {
      "Result": "1",
      "Note": "",
      "Header": {
        "SkuNo": "SKU_test_1",
        "Lot": "",
        "InventoryStatus": "20",
        "TotalQty": 197,
        "OnHandQty": 197,
        "AvailableQty": 199,
        "InTransitQty": 0
      }
    }
  ],
  "WarehouseCode": "631DCA",
  "CompanyCode": "SCCTEST"
}`;

const SPEC_JSON_ERR = `{
  "Head": "ERR",
  "ErrorMsg": "Data processing error: interface call exception:null"
}`;

const SPEC_XML_OK = `<?xml version="1.0" encoding="UTF-8"?>
<Response service="RT_INVENTORY_QUERY_SERVICE">
  <Head>OK</Head>
  <Body>
    <RTInventoryQueryResponse>
      <CompanyCode>SCCTEST</CompanyCode>
      <WarehouseCode>631DCA</WarehouseCode>
      <RTInventorys>
        <RTInventory>
          <Result>1</Result>
          <Note></Note>
          <Header>
            <SkuNo>SKU_test_1</SkuNo>
            <InventoryStatus>10</InventoryStatus>
            <Lot></Lot>
            <ExpirationDate>2024-01-02 03:04:05</ExpirationDate>
            <TotalQty>2068</TotalQty>
            <OnHandQty>1992</OnHandQty>
            <AvailableQty>1775</AvailableQty>
            <InTransitQty>76</InTransitQty>
          </Header>
        </RTInventory>
      </RTInventorys>
    </RTInventoryQueryResponse>
  </Body>
</Response>`;

const SPEC_XML_ERR = `<Response service="RT_INVENTORY_QUERY_SERVICE"><Head>ERR</Head><Error code="NNNNN">System error</Error></Response>`;

function config() {
  return loadSfConfig({
    SF_ISSUED_ACCESS_CODE: "test-access",
    SF_ISSUED_PASS_CODE: "test-pass",
    SF_ISSUED_MD5_CHECKWORD: "test-md5-special",
    SF_LIVE_CALLS_ENABLED: "false",
  });
}

describe("3.18 inventory query", () => {
  it("parses the spec JSON sample and uses AvailableQty for good stock only", () => {
    const document = parseInventoryDocument(SPEC_JSON_OK);
    assert.equal(document.head, "OK");
    assert.equal(document.lines.length, 2);
    assert.equal(document.lines[0]?.skuNo, "SKU_test_1");
    assert.equal(document.lines[0]?.inventoryStatus, "10");
    assert.equal(document.lines[0]?.availableQty, 1775);
    assert.equal(document.lines[0]?.onHandQty, 1992);
    assert.equal(document.lines[0]?.inTransitQty, 76);
    assert.equal(document.lines[1]?.inventoryStatus, "20");
    assert.equal(document.lines[1]?.availableQty, 199);
    const rows = compareInventory({
      requestedSkus: ["SKU_test_1", "MISSING_SKU"],
      sfLines: document.lines,
      shopify: [{ sku: "SKU_test_1", variantCount: 1, tracked: true, available: 12 }],
    });
    const matched = rows.find((row) => row.sku === "SKU_test_1");
    const missing = rows.find((row) => row.sku === "MISSING_SKU");
    assert.equal(matched?.sfAvailable, 1775);
    assert.equal(matched?.shopifyAvailable, 12);
    assert.equal(matched?.match, "matched");
    assert.equal(missing?.match, "none");
    assert.equal(missing?.sfAvailable, null);
  });

  it("parses the spec XML shape and the spec error samples", () => {
    const ok = parseInventoryDocument(SPEC_XML_OK);
    assert.equal(ok.head, "OK");
    assert.equal(ok.companyCode, "SCCTEST");
    assert.equal(ok.lines[0]?.availableQty, 1775);
    assert.equal(ok.lines[0]?.expirationDate, "2024-01-02 03:04:05");
    const xmlErr = parseInventoryDocument(SPEC_XML_ERR);
    assert.equal(xmlErr.head, "ERR");
    assert.equal(xmlErr.errorCode, "NNNNN");
    const jsonErr = parseInventoryDocument(SPEC_JSON_ERR);
    assert.equal(jsonErr.head, "ERR");
    assert.match(jsonErr.errorMessage ?? "", /interface call exception/);
  });

  it("builds a signed 3.18 request for the confirmed codes and good stock", () => {
    const prepared = prepareInventoryQuery(config(), {
      items: [{ skuNo: "SKU_test_1" }],
      inventoryStatus: INVENTORY_STATUS_GOOD,
    });
    const params = new URLSearchParams(prepared.body);
    const plaintext = params.get("logistics_interface") ?? "";
    assert.equal(prepared.serviceCode, "RT_INVENTORY_QUERY_SERVICE");
    assert.equal(prepared.url, SIT_REQUEST_URL);
    assert.match(plaintext, new RegExp(`<CompanyCode>${CONFIRMED_CARGO_OWNER_CODE}</CompanyCode>`));
    assert.match(plaintext, new RegExp(`<WarehouseCode>${CONFIRMED_WAREHOUSE_CODE}</WarehouseCode>`));
    assert.match(plaintext, /<InventoryStatus>10<\/InventoryStatus>/);
    assert.match(plaintext, /<SkuNo>SKU_test_1<\/SkuNo>/);
    assert.equal(plaintext.includes("PassCode"), false);
    assert.equal(plaintext.includes("RT_INVENTORY_PUSH_SERVICE"), false);
    assert.equal(params.get("data_digest"), dataDigest(plaintext, "test-md5-special"));
  });

  it("does not call SF when live calls are off", async () => {
    let called = false;
    const admin: AdminGraphqlClient = {
      graphql: async () => ({
        json: async () => ({
          data: {
            productVariants: {
              nodes: [
                {
                  id: "gid://shopify/ProductVariant/1",
                  sku: "SKU_test_1",
                  inventoryItem: {
                    tracked: true,
                    inventoryLevels: { nodes: [{ quantities: [{ name: "available", quantity: 4 }] }] },
                  },
                },
              ],
            },
          },
        }),
      }),
    };
    const result = await runInventoryPreview({
      config: config(),
      skus: ["SKU_test_1", "ONLY_SHOPIFY"],
      admin,
      fetchImpl: () => {
        called = true;
        return Promise.reject(new Error("fetch should not run"));
      },
    });
    assert.equal(called, false);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.sent, false);
      const row = result.comparison.find((entry) => entry.sku === "SKU_test_1");
      assert.equal(row?.match, "not_queried");
      assert.equal(row?.sfAvailable, null);
      assert.equal(row?.shopifyAvailable, 4);
      const unmatched = result.comparison.find((entry) => entry.sku === "ONLY_SHOPIFY");
      assert.equal(unmatched?.shopifyAvailable, null);
      assert.equal(JSON.stringify(result).includes("test-access"), false);
    }
  });

  it("shows an SF SKU that has no Shopify variant", () => {
    const rows = compareInventory({
      requestedSkus: ["SF_ONLY"],
      sfLines: [
        { skuNo: "SF_ONLY", inventoryStatus: "10", availableQty: 3 },
      ],
      shopify: [],
    });
    assert.equal(rows[0]?.match, "sf_only");
    assert.equal(rows[0]?.sfAvailable, 3);
    assert.equal(rows[0]?.shopifyAvailable, null);
  });

  it("does not define an inventory write", () => {
    const source = readFileSync(new URL("../app/shopify/operations.ts", import.meta.url), "utf8");
    assert.match(source, /VariantInventoryBySku/);
    assert.equal(source.includes("inventoryAdjust"), false);
    assert.equal(source.includes("inventorySet"), false);
    assert.equal(source.includes("RT_INVENTORY_PUSH_SERVICE"), false);
  });
});
