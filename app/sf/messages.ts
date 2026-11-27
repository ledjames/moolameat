import { SERVICE_CODES, type ServiceCode } from "./constants";
import type { PayloadFormat, SfConfig } from "./config";
import { escapeXml, xmlElement } from "./xml";

export type SaleOrderQuery = {
  erpOrder: string;
  shipmentId?: string;
  warehouseCode?: string;
};

function orderElements(order: SaleOrderQuery, includeWarehouse: boolean): string {
  const parts = [
    includeWarehouse && order.warehouseCode
      ? xmlElement("WarehouseCode", escapeXml(order.warehouseCode))
      : "",
    xmlElement("ErpOrder", escapeXml(order.erpOrder)),
    order.shipmentId ? xmlElement("ShipmentId", escapeXml(order.shipmentId)) : "",
  ];
  return parts.join("");
}

export function buildStatusQueryMessage(
  config: SfConfig,
  accessCode: string,
  checkword: string,
  order: SaleOrderQuery,
): string {
  const includeWarehouse = config.includeWarehouseOnQuery && Boolean(order.warehouseCode);
  if (config.payloadFormat === "json") {
    const saleOrder: Record<string, string> = {};
    if (includeWarehouse && order.warehouseCode) saleOrder.WarehouseCode = order.warehouseCode;
    saleOrder.ErpOrder = order.erpOrder;
    if (order.shipmentId) saleOrder.ShipmentId = order.shipmentId;
    return JSON.stringify({
      CompanyCode: config.companyCode,
      AccessCode: accessCode,
      Checkword: checkword,
      ServiceCode: SERVICE_CODES.outboundStatusQuery,
      SaleOrders: [saleOrder],
    });
  }

  const saleOrder = xmlElement(
    "SaleOrder",
    orderElements(order, includeWarehouse),
  );
  const body = xmlElement(
    "Body",
    xmlElement(
      "SaleOrderStatusRequest",
      xmlElement("CompanyCode", escapeXml(config.companyCode)) +
        xmlElement("SaleOrders", saleOrder),
    ),
  );
  const head = xmlElement(
    "Head",
    xmlElement("AccessCode", escapeXml(accessCode)) + xmlElement("Checkword", escapeXml(checkword)),
  );
  return xmlElement("Request", head + body, {
    service: SERVICE_CODES.outboundStatusQuery,
    lang: config.lang,
  });
}

export function encodeForm(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}

export type PreparedSfRequest = {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
  serviceCode: ServiceCode;
  payloadFormat: PayloadFormat;
};

function place(
  headers: Record<string, string>,
  form: Record<string, string>,
  name: string,
  value: string,
  placement: SfConfig["sysSourcePlacement"],
) {
  if (placement === "header" || placement === "both") headers[name] = value;
  if (placement === "form" || placement === "both") form[name] = value;
}

export function wrapSignedRequest(input: {
  url: string;
  plaintext: string;
  digest: string;
  serviceCode: ServiceCode;
  config: SfConfig;
}): PreparedSfRequest {
  const form: Record<string, string> = {
    logistics_interface: input.plaintext,
    data_digest: input.digest,
  };
  const headers: Record<string, string> = {
    "Content-Type": input.config.contentType,
  };
  place(headers, form, "sysSource", input.config.sysSource, input.config.sysSourcePlacement);
  place(
    headers,
    form,
    "serviceCode",
    input.serviceCode,
    input.config.serviceCodePlacement,
  );
  return {
    url: input.url,
    method: "POST",
    headers,
    body: encodeForm(form),
    serviceCode: input.serviceCode,
    payloadFormat: input.config.payloadFormat,
  };
}
