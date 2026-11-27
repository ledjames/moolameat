import type { ShopifySkuStock } from "../inventory/compare";
import type { AdminGraphqlClient } from "./apply-tracking";
import { VARIANT_INVENTORY_QUERY } from "./operations";

type VariantNode = {
  id: string;
  sku: string | null;
  inventoryItem: {
    tracked: boolean;
    inventoryLevels: {
      nodes: Array<{
        quantities: Array<{ name: string; quantity: number }>;
      }>;
    };
  } | null;
};

type InventoryQueryJson = {
  data?: {
    productVariants?: {
      nodes?: VariantNode[];
    };
  };
  errors?: Array<{ message?: string }>;
};

export function skuSearchQuery(skus: string[]): string {
  return skus.map((sku) => `sku:${JSON.stringify(sku)}`).join(" OR ");
}

function availableQuantity(node: VariantNode): number | null {
  const item = node.inventoryItem;
  if (!item?.tracked) return null;
  return item.inventoryLevels.nodes
    .flatMap((level) => level.quantities)
    .filter((quantity) => quantity.name === "available")
    .reduce((sum, quantity) => sum + quantity.quantity, 0);
}

export async function readShopifySkus(
  admin: AdminGraphqlClient,
  skus: string[],
): Promise<{ skus: ShopifySkuStock[]; error?: string }> {
  if (skus.length === 0) return { skus: [] };
  try {
    const response = await admin.graphql(VARIANT_INVENTORY_QUERY, {
      variables: { query: skuSearchQuery(skus) },
    });
    const json = (await response.json()) as InventoryQueryJson;
    if (json.errors?.length) {
      return {
        skus: [],
        error: json.errors.map((error) => error.message ?? "Admin API error").join("; "),
      };
    }
    const grouped = new Map<string, ShopifySkuStock>();
    for (const node of json.data?.productVariants?.nodes ?? []) {
      const sku = node.sku?.trim();
      if (!sku) continue;
      const available = availableQuantity(node);
      const current = grouped.get(sku);
      if (!current) {
        grouped.set(sku, {
          sku,
          variantCount: 1,
          tracked: Boolean(node.inventoryItem?.tracked),
          available,
        });
        continue;
      }
      current.variantCount += 1;
      current.tracked = current.tracked || Boolean(node.inventoryItem?.tracked);
      if (available !== null) current.available = (current.available ?? 0) + available;
    }
    return { skus: [...grouped.values()] };
  } catch {
    return { skus: [], error: "Shopify inventory could not be read." };
  }
}
