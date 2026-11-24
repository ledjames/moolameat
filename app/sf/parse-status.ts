import { child, descendants, parseXml, textOf, type XmlNode } from "./xml";

export type SfStep = {
  eventTime?: string;
  eventAddress?: string;
  status?: string;
  note?: string;
};

export type SfOutboundOrder = {
  result?: string;
  erpOrder?: string;
  note?: string;
  dataStatus?: string;
  warehouseCode?: string;
  erpOrderType?: string;
  wayBillNo?: string;
  deliveryProof?: string;
  shipmentId?: string;
  waves?: string;
  cartNum?: string;
  gridNum?: string;
  tradeOrder?: string;
  carrier?: string;
  carrierProduct?: string;
  isSplit?: string;
  labelUrl?: string;
  orderStatus?: string;
  steps: SfStep[];
};

export type SfStatusDocument = {
  format: "xml" | "json";
  service?: string;
  head?: string;
  errorCode?: string;
  errorMessage?: string;
  orders: SfOutboundOrder[];
};

function asString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function pick(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = asString(record[key]);
    if (value) return value;
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return [value];
  return [];
}

function stepsFrom(value: unknown): SfStep[] {
  return asArray(value).map((entry) => {
    const record = asRecord(entry) ?? {};
    return {
      eventTime: pick(record, "EventTime", "eventTime"),
      eventAddress: pick(record, "EventAddress", "eventAddress"),
      status: pick(record, "Status", "status"),
      note: pick(record, "Note", "note"),
    };
  });
}

function orderFromRecord(record: Record<string, unknown>): SfOutboundOrder {
  const header = asRecord(record.Header) ?? asRecord(record.header) ?? {};
  const carrierInfo =
    asRecord(record.OrderCarrierInfo) ?? asRecord(record.orderCarrierInfo) ?? {};
  const source = { ...record, ...header };
  return {
    result: pick(record, "Result", "result"),
    erpOrder: pick(source, "ErpOrder", "erpOrder"),
    note: pick(record, "Note", "note"),
    dataStatus: pick(record, "DataStatus", "dataStatus"),
    warehouseCode: pick(source, "WarehouseCode", "warehouseCode"),
    erpOrderType: pick(source, "ErpOrderType", "erpOrderType"),
    wayBillNo: pick(source, "WayBillNo", "wayBillNo"),
    deliveryProof: pick(source, "DeliveryProof", "deliveryProof"),
    shipmentId: pick(source, "ShipmentId", "shipmentId"),
    waves: pick(source, "Waves", "waves"),
    cartNum: pick(source, "CartNum", "cartNum"),
    gridNum: pick(source, "GridNum", "gridNum"),
    tradeOrder: pick(source, "TradeOrder", "tradeOrder"),
    carrier: pick(source, "Carrier", "carrier"),
    carrierProduct: pick(source, "CarrierProduct", "carrierProduct"),
    isSplit: pick(source, "IsSplit", "isSplit"),
    labelUrl: pick(source, "labelUrl", "LabelUrl") ?? pick(carrierInfo, "labelUrl", "LabelUrl"),
    orderStatus: pick(header, "OrderStatus", "orderStatus") ?? pick(record, "OrderStatus", "orderStatus"),
    steps: stepsFrom(record.steps ?? record.Steps ?? record.Step ?? header.Steps),
  };
}

function xmlSteps(order: XmlNode): SfStep[] {
  const steps = child(order, "Steps") ?? child(order, "steps");
  const nodes = steps ? childrenOf(steps, "Step").concat(childrenOf(steps, "step")) : childrenOf(order, "Step");
  return nodes.map((step) => ({
    eventTime: textOf(step, "EventTime"),
    eventAddress: textOf(step, "EventAddress"),
    status: textOf(step, "Status"),
    note: textOf(step, "Note"),
  }));
}

function childrenOf(node: XmlNode, name: string): XmlNode[] {
  return node.children.filter((entry) => entry.name === name);
}

function xmlOrder(order: XmlNode): SfOutboundOrder {
  const header = child(order, "Header");
  const carrier = child(order, "OrderCarrierInfo");
  return {
    result: textOf(order, "Result"),
    erpOrder: textOf(header, "ErpOrder") ?? textOf(order, "ErpOrder"),
    note: textOf(order, "Note"),
    dataStatus: textOf(order, "DataStatus"),
    warehouseCode: textOf(header, "WarehouseCode") ?? textOf(order, "WarehouseCode"),
    erpOrderType: textOf(header, "ErpOrderType") ?? textOf(order, "ErpOrderType"),
    wayBillNo: textOf(header, "WayBillNo") ?? textOf(order, "WayBillNo"),
    deliveryProof: textOf(header, "DeliveryProof") ?? textOf(order, "DeliveryProof"),
    shipmentId: textOf(header, "ShipmentId") ?? textOf(order, "ShipmentId"),
    waves: textOf(header, "Waves") ?? textOf(order, "Waves"),
    cartNum: textOf(header, "CartNum") ?? textOf(order, "CartNum"),
    gridNum: textOf(header, "GridNum") ?? textOf(order, "GridNum"),
    tradeOrder: textOf(header, "TradeOrder") ?? textOf(order, "TradeOrder"),
    carrier: textOf(header, "Carrier") ?? textOf(order, "Carrier"),
    carrierProduct: textOf(header, "CarrierProduct") ?? textOf(order, "CarrierProduct"),
    isSplit: textOf(header, "IsSplit") ?? textOf(order, "IsSplit"),
    labelUrl: textOf(carrier, "labelUrl") ?? textOf(order, "labelUrl"),
    orderStatus: textOf(header, "OrderStatus") ?? textOf(order, "OrderStatus"),
    steps: xmlSteps(order),
  };
}

export function parseXmlStatus(source: string): SfStatusDocument {
  const root = parseXml(source);
  const error = child(root, "Error");
  return {
    format: "xml",
    service: root.attributes.service,
    head: textOf(root, "Head"),
    errorCode: error?.attributes.code,
    errorMessage: error?.text || undefined,
    orders: descendants(root, "SaleOrder").map(xmlOrder),
  };
}

export function parseJsonStatus(source: string): SfStatusDocument {
  const parsed = JSON.parse(source) as unknown;
  const root = asRecord(parsed);
  if (!root) throw new Error("JSON status document is not an object");
  const body = asRecord(root.Body) ?? root;
  const orders = [
    ...asArray(body.SaleOrders),
    ...asArray(body.SaleOrder),
    ...asArray(root.SaleOrders),
    ...asArray(root.SaleOrder),
  ];
  const seen = new Set<unknown>();
  const unique = orders.filter((order) => {
    if (seen.has(order)) return false;
    seen.add(order);
    return true;
  });
  return {
    format: "json",
    service: pick(root, "ServiceCode", "service"),
    head: pick(root, "Head", "head"),
    errorMessage: pick(root, "ErrorMsg", "message"),
    orders: unique.map((order) => orderFromRecord(asRecord(order) ?? {})),
  };
}

export function extractLogisticsInterface(raw: string, contentType: string | null): string {
  const trimmed = raw.trim();
  const looksLikeForm =
    contentType?.includes("application/x-www-form-urlencoded") ||
    trimmed.startsWith("logistics_interface=");
  if (!looksLikeForm) return trimmed;
  const params = new URLSearchParams(trimmed);
  return params.get("logistics_interface") ?? trimmed;
}

export function parseStatusDocument(raw: string, contentType: string | null = null): SfStatusDocument {
  const payload = extractLogisticsInterface(raw, contentType).trim();
  if (payload.startsWith("<")) return parseXmlStatus(payload);
  if (payload.startsWith("{") || payload.startsWith("[")) return parseJsonStatus(payload);
  throw new Error("Status document is neither XML nor JSON");
}
