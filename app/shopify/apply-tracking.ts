import type { OrderMatchMode } from "../sf/config";
import { TRACKING_INFO_UPDATE, TRACKING_ORDER_QUERY } from "./operations";
import {
  shopifyOrderSearchQuery,
  type OrderLookup,
  type ShopifyOrderSnapshot,
  type TrackingPlan,
} from "./tracking-plan";

export type AdminGraphqlClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<{ json: () => Promise<unknown> }>;
};

type OrderQueryJson = {
  data?: {
    orders?: {
      nodes?: ShopifyOrderSnapshot[];
    };
  };
  errors?: Array<{ message?: string }>;
};

export async function lookupTrackingOrder(
  admin: AdminGraphqlClient,
  erpOrder: string,
  mode: OrderMatchMode,
): Promise<OrderLookup> {
  const response = await admin.graphql(TRACKING_ORDER_QUERY, {
    variables: { query: shopifyOrderSearchQuery(erpOrder, mode) },
  });
  const json = (await response.json()) as OrderQueryJson;
  if (json.errors?.length) {
    throw new Error(json.errors.map((error) => error.message ?? "Admin API error").join("; "));
  }
  const nodes = json.data?.orders?.nodes ?? [];
  if (nodes.length === 0) return { status: "not_found" };
  if (nodes.length > 1) return { status: "ambiguous", count: nodes.length };
  return { status: "found", order: nodes[0]! };
}

export type TrackingWriteResult = {
  applied: boolean;
  reason: string;
  userErrors?: Array<{ field?: string[] | null; message: string }>;
};

export async function applyTrackingPlan(
  admin: AdminGraphqlClient,
  plan: TrackingPlan,
  trackingWritesEnabled: boolean,
): Promise<TrackingWriteResult> {
  if (!trackingWritesEnabled) {
    return {
      applied: false,
      reason:
        "Shopify tracking writes are disabled. No fulfillment was updated and inventory was not changed.",
    };
  }
  if (plan.action !== "update_tracking" || !plan.fulfillmentId || !plan.wayBillNo) {
    return { applied: false, reason: plan.blockReason ?? "There is no tracking update to apply." };
  }

  const response = await admin.graphql(TRACKING_INFO_UPDATE, {
    variables: {
      fulfillmentId: plan.fulfillmentId,
      notifyCustomer: plan.notifyCustomer,
      trackingInfoInput: {
        company: plan.shopifyCompany,
        number: plan.wayBillNo,
      },
    },
  });
  const json = (await response.json()) as {
    data?: {
      fulfillmentTrackingInfoUpdate?: {
        userErrors?: Array<{ field?: string[] | null; message: string }>;
      };
    };
    errors?: Array<{ message?: string }>;
  };
  if (json.errors?.length) {
    return {
      applied: false,
      reason: json.errors.map((error) => error.message ?? "Admin API error").join("; "),
    };
  }
  const userErrors = json.data?.fulfillmentTrackingInfoUpdate?.userErrors ?? [];
  if (userErrors.length > 0) {
    return { applied: false, reason: "Shopify returned user errors.", userErrors };
  }
  return { applied: true, reason: "Tracking number was saved on the existing fulfillment." };
}
