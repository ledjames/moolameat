import { SHOPIFY_TRACKING_COMPANY } from "../sf/constants";
import type { SfOutboundOrder } from "../sf/parse-status";
import { describeStatus } from "../sf/status-codes";
import type { OrderMatchMode } from "../sf/config";

export type ShopifyFulfillmentSnapshot = {
  id: string;
  status: string;
  createdAt: string;
  trackingInfo: Array<{ company?: string | null; number?: string | null; url?: string | null }>;
};

export type ShopifyOrderSnapshot = {
  id: string;
  name: string;
  displayFinancialStatus: string | null;
  fulfillments: ShopifyFulfillmentSnapshot[];
};

export type OrderLookup =
  | { status: "found"; order: ShopifyOrderSnapshot }
  | { status: "not_found" }
  | { status: "ambiguous"; count: number }
  | { status: "not_looked_up" };

export type TrackingPlan = {
  action: "update_tracking" | "blocked";
  blockReason?: string;
  inventoryImpact: "none";
  mutation: "fulfillmentTrackingInfoUpdate" | null;
  shopifyOrderId?: string;
  shopifyOrderName?: string;
  paid: boolean;
  fulfillmentId?: string;
  wayBillNo?: string;
  carrierCode?: string;
  shopifyCompany: typeof SHOPIFY_TRACKING_COMPANY;
  trackingUrl: null;
  notifyCustomer: boolean;
  orderStatus?: string;
  orderStatusDescription?: string;
  latestStepStatus?: string;
  latestStepDescription?: string;
  unconfirmed: string[];
};

export const FIELD_MAPPINGS = [
  {
    sf: "CompanyCode",
    shopify: "Checked against the confirmed cargo owner code. Not written to the order.",
    state: "Confirmed code",
  },
  {
    sf: "WarehouseCode",
    shopify: "Sent on the 3.16 query as 852DCTZ. Not a Shopify location id.",
    state: "Confirmed code",
  },
  {
    sf: "ErpOrder",
    shopify: "Default match is Shopify order name, with or without a leading #. Numeric order id is optional.",
    state: "Unconfirmed",
  },
  {
    sf: "ShipmentId",
    shopify: "Optional SF outbound order number. Not a Shopify fulfillment id.",
    state: "Unconfirmed",
  },
  {
    sf: "WayBillNo",
    shopify: "FulfillmentTrackingInput.number on an existing fulfillment.",
    state: "From spec, as the waybill number",
  },
  {
    sf: "Carrier",
    shopify: `Raw code is kept. The tracking company sent to Shopify is "${SHOPIFY_TRACKING_COMPANY}".`,
    state: "Unconfirmed",
  },
  {
    sf: "labelUrl (3.15 OrderCarrierInfo)",
    shopify: "Not copied to the tracking URL. The spec calls it a waybill URL, which may be a label.",
    state: "Unconfirmed",
  },
  {
    sf: "OrderStatus / Step.Status / DataStatus",
    shopify: "Shown in the app. Not written as Shopify fulfillment events in this pass.",
    state: "Unconfirmed",
  },
  {
    sf: "TradeOrder",
    shopify: "Platform transaction number. Not used to find the Shopify order.",
    state: "Unconfirmed",
  },
] as const;

export const ALWAYS_UNCONFIRMED = [
  "Which SF field is the Shopify order name or id. The default is ErpOrder matched to the order name.",
  `Which Carrier code means the Shopify company "${SHOPIFY_TRACKING_COMPANY}". The company name is sent so Shopify can build a tracking URL.`,
  "Whether labelUrl is safe to show a customer. It is not used as the tracking URL.",
  "How SF status codes map to Shopify fulfillment events. Events are not created.",
  "How IsSplit=Y maps onto more than one Shopify fulfillment.",
  "Whether PARTIALLY_PAID orders should receive tracking. Only PAID orders are eligible.",
];

const CLOSED_FULFILLMENT = new Set(["CANCELLED", "CANCELED", "FAILURE", "ERROR"]);

export function shopifyOrderSearchQuery(erpOrder: string, mode: OrderMatchMode): string {
  if (mode === "numeric_id") {
    const digits = erpOrder.replace(/\D/g, "");
    return `id:${digits}`;
  }
  const name = erpOrder.trim().replace(/^#/, "");
  return `name:${name}`;
}

function hasTrackingNumber(fulfillment: ShopifyFulfillmentSnapshot, waybill: string): boolean {
  return fulfillment.trackingInfo.some((info) => info.number?.trim() === waybill);
}

function trackingIsEmpty(fulfillment: ShopifyFulfillmentSnapshot): boolean {
  return fulfillment.trackingInfo.every((info) => !info.number?.trim());
}

export function buildTrackingPlan(
  sfOrder: SfOutboundOrder,
  lookup: OrderLookup,
  options: { notifyCustomer: boolean },
): TrackingPlan {
  const latest = sfOrder.steps.at(-1);
  const base: TrackingPlan = {
    action: "blocked",
    inventoryImpact: "none",
    mutation: null,
    wayBillNo: sfOrder.wayBillNo,
    carrierCode: sfOrder.carrier,
    shopifyCompany: SHOPIFY_TRACKING_COMPANY,
    trackingUrl: null,
    notifyCustomer: options.notifyCustomer,
    orderStatus: sfOrder.orderStatus ?? sfOrder.dataStatus,
    orderStatusDescription: describeStatus(sfOrder.orderStatus ?? sfOrder.dataStatus),
    latestStepStatus: latest?.status,
    latestStepDescription: describeStatus(latest?.status),
    unconfirmed: [...ALWAYS_UNCONFIRMED],
    paid: false,
  };

  if (lookup.status === "not_looked_up") {
    return { ...base, blockReason: "Shopify order was not looked up." };
  }
  if (lookup.status === "not_found") {
    return { ...base, blockReason: "No Shopify order matched ErpOrder." };
  }
  if (lookup.status === "ambiguous") {
    return {
      ...base,
      blockReason: `ErpOrder matched ${lookup.count} Shopify orders.`,
    };
  }

  const order = lookup.order;
  const paid = order.displayFinancialStatus === "PAID";
  const withOrder: TrackingPlan = {
    ...base,
    shopifyOrderId: order.id,
    shopifyOrderName: order.name,
    paid,
  };
  if (!paid) {
    return {
      ...withOrder,
      blockReason: `Order ${order.name} is ${order.displayFinancialStatus ?? "unpaid"}, not PAID.`,
    };
  }
  if (!sfOrder.wayBillNo) {
    return { ...withOrder, blockReason: "SF did not return a WayBillNo." };
  }
  if (sfOrder.isSplit === "Y") {
    return {
      ...withOrder,
      blockReason: "SF marked the order as split. Which fulfillment gets the waybill is unconfirmed.",
    };
  }

  const open = order.fulfillments.filter((fulfillment) => !CLOSED_FULFILLMENT.has(fulfillment.status));
  if (open.length === 0) {
    return {
      ...withOrder,
      blockReason:
        "The paid order has no open fulfillment. This app does not call fulfillmentCreate, because that can change inventory quantities.",
    };
  }

  const already = open.filter((fulfillment) => hasTrackingNumber(fulfillment, sfOrder.wayBillNo!));
  const empty = open.filter(trackingIsEmpty);
  let chosen: ShopifyFulfillmentSnapshot | undefined;
  if (already.length === 1) chosen = already[0];
  else if (open.length === 1) chosen = open[0];
  else if (empty.length === 1) chosen = empty[0];

  if (!chosen) {
    return {
      ...withOrder,
      blockReason: "More than one fulfillment could take this waybill. None was chosen.",
    };
  }

  return {
    ...withOrder,
    action: "update_tracking",
    mutation: "fulfillmentTrackingInfoUpdate",
    fulfillmentId: chosen.id,
    blockReason: undefined,
  };
}
