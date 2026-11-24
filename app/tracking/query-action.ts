import { prepareStatusQuery, sendPreparedRequest, SfLiveCallsDisabledError } from "../sf/client";
import { queryGate, type SfConfig } from "../sf/config";
import { parseStatusDocument, type SfOutboundOrder } from "../sf/parse-status";
import { SERVICE_CODES } from "../sf/constants";
import { applyTrackingPlan, lookupTrackingOrder, type AdminGraphqlClient } from "../shopify/apply-tracking";
import { buildTrackingPlan, type TrackingPlan } from "../shopify/tracking-plan";

export type PublicSfOrder = {
  erpOrder?: string;
  result?: string;
  note?: string;
  wayBillNo?: string;
  orderStatus?: string;
  carrier?: string;
  shipmentId?: string;
  isSplit?: string;
  steps: Array<{ status?: string; note?: string; eventTime?: string }>;
};

export type QueryActionResult =
  | { ok: false; error: string }
  | {
      ok: true;
      sent: false;
      reason: string;
      serviceCode: string;
      environment: string;
      erpOrder: string;
    }
  | {
      ok: true;
      sent: true;
      serviceCode: string;
      environment: string;
      erpOrder: string;
      httpStatus: number;
      head: string | null;
      parseError?: string;
      orders: PublicSfOrder[];
      plan: TrackingPlan | null;
      shopifyWrite: { applied: boolean; reason: string };
    };

function publicOrder(order: SfOutboundOrder): PublicSfOrder {
  return {
    erpOrder: order.erpOrder,
    result: order.result,
    note: order.note,
    wayBillNo: order.wayBillNo,
    orderStatus: order.orderStatus ?? order.dataStatus,
    carrier: order.carrier,
    shipmentId: order.shipmentId,
    isSplit: order.isSplit,
    steps: order.steps.map((step) => ({
      status: step.status,
      note: step.note,
      eventTime: step.eventTime,
    })),
  };
}

export async function runStatusQuery(input: {
  config: SfConfig;
  erpOrder: string;
  shipmentId?: string;
  fetchImpl?: typeof fetch;
  admin?: AdminGraphqlClient;
}): Promise<QueryActionResult> {
  const erpOrder = input.erpOrder.trim();
  if (!erpOrder) return { ok: false, error: "Enter the ERP order number to query." };
  if (erpOrder.length > 64) {
    return { ok: false, error: "ErpOrder is longer than the 64 character spec limit." };
  }
  const shipmentId = input.shipmentId?.trim();
  if (shipmentId && shipmentId.length > 64) {
    return { ok: false, error: "ShipmentId is longer than the 64 character spec limit." };
  }

  const gate = queryGate(input.config);
  if (!gate.enabled) return { ok: false, error: gate.reasons.join(" ") };

  const prepared = prepareStatusQuery(input.config, { erpOrder, shipmentId });
  if (!input.config.liveCallsEnabled) {
    return {
      ok: true,
      sent: false,
      reason:
        "SF live calls are disabled. The 3.16 request was built locally and was not sent.",
      serviceCode: prepared.serviceCode,
      environment: input.config.environment,
      erpOrder,
    };
  }

  let response: { status: number; body: string };
  try {
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
        serviceCode: SERVICE_CODES.outboundStatusQuery,
        environment: input.config.environment,
        erpOrder,
      };
    }
    return { ok: false, error: "The SF request failed before a response was parsed." };
  }

  let orders: SfOutboundOrder[] = [];
  let head: string | null = null;
  let parseError: string | undefined;
  try {
    const document = parseStatusDocument(response.body);
    head = document.head ?? null;
    orders = document.orders;
  } catch {
    parseError = "The SF response was not an XML or JSON status document this app understands.";
  }

  const first = orders[0];
  let plan: TrackingPlan | null = null;
  if (first && input.admin) {
    const lookup = await lookupTrackingOrder(input.admin, first.erpOrder ?? erpOrder, input.config.orderMatch);
    plan = buildTrackingPlan(first, lookup, { notifyCustomer: input.config.notifyCustomer });
  } else if (first) {
    plan = buildTrackingPlan(first, { status: "not_looked_up" }, { notifyCustomer: input.config.notifyCustomer });
  }

  const shopifyWrite = plan
    ? await applyTrackingPlan(input.admin ?? unusedAdmin(), plan, input.config.trackingWritesEnabled)
    : {
        applied: false,
        reason: parseError ?? "SF returned no outbound order to map.",
      };

  return {
    ok: true,
    sent: true,
    serviceCode: prepared.serviceCode,
    environment: input.config.environment,
    erpOrder,
    httpStatus: response.status,
    head,
    parseError,
    orders: orders.map(publicOrder),
    plan,
    shopifyWrite: { applied: shopifyWrite.applied, reason: shopifyWrite.reason },
  };
}

function unusedAdmin(): AdminGraphqlClient {
  return {
    graphql: () => Promise.reject(new Error("No Shopify admin client was provided.")),
  };
}
