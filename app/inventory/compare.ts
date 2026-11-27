import { INVENTORY_STATUS_GOOD } from "../sf/constants";
import { goodStockAvailable, type SfInventoryLine } from "../sf/inventory";

export type ShopifySkuStock = {
  sku: string;
  variantCount: number;
  tracked: boolean;
  available: number | null;
};

export type ComparisonMatch = "matched" | "sf_only" | "shopify_only" | "not_queried" | "none";

export type ComparisonRow = {
  sku: string;
  sfAvailable: number | null;
  shopifyAvailable: number | null;
  match: ComparisonMatch;
};

export function parseSkuList(raw: string): { skus: string[] } | { error: string } {
  const skus = [
    ...new Set(
      raw
        .split(/[\s,]+/)
        .map((sku) => sku.trim())
        .filter((sku) => sku.length > 0),
    ),
  ];
  if (skus.length === 0) return { error: "Enter at least one SKU." };
  if (skus.length > 20) return { error: "Query at most 20 SKUs. The spec batch limit is 20." };
  const tooLong = skus.find((sku) => sku.length > 32);
  if (tooLong) return { error: "SkuNo is longer than the 32 character spec limit." };
  return { skus };
}

export function compareInventory(input: {
  requestedSkus: string[];
  sfLines: SfInventoryLine[] | null;
  shopify: ShopifySkuStock[];
}): ComparisonRow[] {
  const shopifyBySku = new Map(input.shopify.map((row) => [row.sku, row]));
  const sfSkus =
    input.sfLines?.flatMap((line) =>
      line.skuNo && line.inventoryStatus === INVENTORY_STATUS_GOOD ? [line.skuNo] : [],
    ) ?? [];
  const skus = [...new Set([...input.requestedSkus, ...sfSkus, ...input.shopify.map((row) => row.sku)])];
  return skus.map((sku) => {
    const shopify = shopifyBySku.get(sku);
    const sfAvailable = input.sfLines ? goodStockAvailable(input.sfLines, sku) : null;
    const shopifyAvailable = shopify?.available ?? null;
    let match: ComparisonMatch = "not_queried";
    if (input.sfLines) {
      if (sfAvailable !== null && shopify) match = "matched";
      else if (sfAvailable !== null) match = "sf_only";
      else if (shopify) match = "shopify_only";
      else match = "none";
    }
    return { sku, sfAvailable, shopifyAvailable, match };
  });
}
