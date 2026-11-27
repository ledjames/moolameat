/**
 * Status codes transcribed from SCC-OMS sections 3.15 and 3.16.
 * The two sections describe some of the same numbers differently.
 * Nothing here is a Shopify fulfillment event.
 */

export type StatusCode = {
  code: string;
  pushDataStatus?: string;
  queryStepStatus?: string;
};

export const OUTBOUND_STATUS_CODES: StatusCode[] = [
  { code: "1100", pushDataStatus: "Effective", queryStepStatus: "Your order has been received" },
  { code: "1200", pushDataStatus: "Occupied" },
  { code: "1400", pushDataStatus: "Cancelled", queryStepStatus: "Your order has been cancelled" },
  { code: "1500", pushDataStatus: "Frozen", queryStepStatus: "Your order has been frozen" },
  {
    code: "1600",
    pushDataStatus: "Pending Review",
    queryStepStatus: "Your order has been submitted and is pending review",
  },
  { code: "1700", pushDataStatus: "Approved", queryStepStatus: "Your order has been reviewed" },
  { code: "1800", queryStepStatus: "Your order is being released to the warehouse" },
  {
    code: "2000",
    pushDataStatus: "Released",
    queryStepStatus: "Your order has entered the warehouse and is being prepared for outbound",
  },
  {
    code: "2300",
    pushDataStatus: "Pending work",
    queryStepStatus: "Your order is being prepared for picking",
  },
  { code: "2400", pushDataStatus: "Picking completed" },
  { code: "2650", pushDataStatus: "Review Completed" },
  { code: "2700", pushDataStatus: "Packing Completed", queryStepStatus: "Your order has been packed" },
  { code: "2800", pushDataStatus: "Outbound Order Confirmation" },
  {
    code: "2900",
    pushDataStatus: "Shipment Confirmation",
    queryStepStatus: "Your order has left the warehouse and is on its way to the sorting center",
  },
  { code: "3900", pushDataStatus: "Order completed", queryStepStatus: "Your order has been completed" },
];

export function describeStatus(code: string | undefined): string | undefined {
  if (!code) return undefined;
  const found = OUTBOUND_STATUS_CODES.find((entry) => entry.code === code);
  if (!found) return undefined;
  return found.queryStepStatus ?? found.pushDataStatus;
}
