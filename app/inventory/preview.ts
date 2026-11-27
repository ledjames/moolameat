import { prepareInventoryQuery, sendPreparedRequest, SfLiveCallsDisabledError } from "../sf/client";
import { queryGate, type SfConfig } from "../sf/config";
import { CONFIRMED_WAREHOUSE_CODE, INVENTORY_STATUS_GOOD, SERVICE_CODES } from "../sf/constants";
import { parseInventoryDocument, type SfInventoryLine } from "../sf/inventory";
import type { AdminGraphqlClient } from "../shopify/apply-tracking";
import { readShopifySkus } from "../shopify/read-inventory";
import { compareInventory, type ComparisonRow, type ShopifySkuStock } from "./compare";

export type InventoryPreviewResult =
  | { ok: false; error: string }
  | {
      ok: true;
      sent: false;
      reason: string;
      serviceCode: string;
      comparison: ComparisonRow[];
      lots: SfInventoryLine[];
      shopifyError?: string;
      warehouseNote?: string;
    }
  | {
      ok: true;
      sent: true;
      serviceCode: string;
      head: string | null;
      parseError?: string;
      errorMessage?: string;
      comparison: ComparisonRow[];
      lots: SfInventoryLine[];
      shopifyError?: string;
      warehouseNote?: string;
    };

export async function runInventoryPreview(input: {
  config: SfConfig;
  skus: string[];
  admin?: AdminGraphqlClient;
  fetchImpl?: typeof fetch;
}): Promise<InventoryPreviewResult> {
  const gate = queryGate(input.config);
  if (!gate.enabled) return { ok: false, error: gate.reasons.join(" ") };

  const shopify = input.admin
    ? await readShopifySkus(input.admin, input.skus)
    : { skus: [] as ShopifySkuStock[] };

  if (!input.config.liveCallsEnabled) {
    return {
      ok: true,
      sent: false,
      reason: "SF live calls are disabled. No inventory query was sent. AvailableQty was not loaded from SF.",
      serviceCode: SERVICE_CODES.inventoryQuery,
      comparison: compareInventory({
        requestedSkus: input.skus,
        sfLines: null,
        shopify: shopify.skus,
      }),
      lots: [],
      shopifyError: shopify.error,
    };
  }

  let response: { status: number; body: string };
  try {
    const prepared = prepareInventoryQuery(input.config, {
      items: input.skus.map((skuNo) => ({ skuNo })),
      inventoryStatus: INVENTORY_STATUS_GOOD,
    });
    response = await sendPreparedRequest(prepared, {
      liveCallsEnabled: true,
      fetchImpl: input.fetchImpl,
    });
  } catch (error) {
    if (error instanceof SfLiveCallsDisabledError) {
      return {
        ok: true,
        sent: false,
        reason: error.message,
        serviceCode: SERVICE_CODES.inventoryQuery,
        comparison: compareInventory({
          requestedSkus: input.skus,
          sfLines: null,
          shopify: shopify.skus,
        }),
        lots: [],
        shopifyError: shopify.error,
      };
    }
    return { ok: false, error: "The SF inventory request failed before a response was parsed." };
  }

  let lines: SfInventoryLine[] = [];
  let head: string | null = null;
  let parseError: string | undefined;
  let errorMessage: string | undefined;
  let warehouseNote: string | undefined;
  try {
    const document = parseInventoryDocument(response.body);
    head = document.head ?? null;
    errorMessage = document.errorMessage;
    lines = document.lines;
    if (document.warehouseCode && document.warehouseCode !== input.config.warehouseCode) {
      warehouseNote = `SF returned warehouse ${document.warehouseCode}. This app queries ${CONFIRMED_WAREHOUSE_CODE}.`;
    }
  } catch {
    parseError = "The SF response was not an inventory document this app understands.";
  }

  return {
    ok: true,
    sent: true,
    serviceCode: SERVICE_CODES.inventoryQuery,
    head,
    parseError,
    errorMessage,
    comparison: compareInventory({
      requestedSkus: input.skus,
      sfLines: parseError ? null : lines,
      shopify: shopify.skus,
    }),
    lots: lines,
    shopifyError: shopify.error,
    warehouseNote,
  };
}
