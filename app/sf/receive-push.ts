import { OUTBOUND_STATUS_PUSH_PATH, SERVICE_CODES } from "./constants";
import { resolveSecrets, type SfConfig } from "./config";
import { parseStatusDocument, type SfOutboundOrder, type SfStatusDocument } from "./parse-status";
import { dataDigest, secretEqual } from "./sign";
import { escapeXml, parseXml, textOf, type XmlNode } from "./xml";
import { applyTrackingPlan, lookupTrackingOrder, type AdminGraphqlClient } from "../shopify/apply-tracking";
import { buildTrackingPlan } from "../shopify/tracking-plan";

export { OUTBOUND_STATUS_PUSH_PATH };

const FORM_CONTENT_TYPE = "application/x-www-form-urlencoded";
const NOTE_LIMIT = 256;

export type PushHeaders = {
  sysSource: string | null;
  serviceCode: string | null;
};

type Envelope = {
  format: "xml" | "json";
  accessCode?: string;
  checkword?: string;
  companyCode?: string;
  service?: string;
  document: SfStatusDocument;
};

function clip(value: string): string {
  return value.length <= NOTE_LIMIT ? value : value.slice(0, NOTE_LIMIT);
}

function xmlResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}

function jsonResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}

export function pushOkResponse(format: "xml" | "json"): Response {
  if (format === "json") {
    return jsonResponse(JSON.stringify({ result: "1", message: "SUCCESS", data: null }));
  }
  const xml =
    `<Response service="${SERVICE_CODES.outboundStatusPush}">` +
    `<Head>OK</Head><Body><SaleOrderStatusResponse>` +
    `<Result>1</Result><Note>SUCCESS</Note>` +
    `</SaleOrderStatusResponse></Body></Response>`;
  return xmlResponse(xml);
}

export function pushDataFailureResponse(format: "xml" | "json", note: string): Response {
  const text = clip(note);
  if (format === "json") {
    return jsonResponse(JSON.stringify({ result: "0", message: text, data: null }));
  }
  const xml =
    `<Response service="${SERVICE_CODES.outboundStatusPush}">` +
    `<Head>PART</Head><Body><SaleOrderStatusResponse>` +
    `<Result>2</Result><Note>${escapeXml(text)}</Note>` +
    `</SaleOrderStatusResponse></Body></Response>`;
  return xmlResponse(xml);
}

export function pushSystemErrorResponse(format: "xml" | "json", message: string): Response {
  const text = clip(message);
  if (format === "json") {
    return jsonResponse(JSON.stringify({ result: "0", message: text, data: null }));
  }
  const xml =
    `<Response service="${SERVICE_CODES.outboundStatusPush}">` +
    `<Head>ERR</Head><Error code="0">${escapeXml(text)}</Error></Response>`;
  return xmlResponse(xml);
}

export function pushMethodNotAllowedResponse(): Response {
  return new Response(
    `POST ${OUTBOUND_STATUS_PUSH_PATH} receives SCC-OMS 3.15 outbound status. ` +
      "The host is SHOPIFY_APP_URL after this app is deployed. This response is not a push acknowledgement.",
    {
      status: 405,
      headers: {
        Allow: "POST",
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex",
      },
    },
  );
}

function contentTypeAllowed(contentType: string | null): boolean {
  if (!contentType) return false;
  const media = contentType.split(";")[0]?.trim().toLowerCase();
  return media === FORM_CONTENT_TYPE;
}

function readXmlEnvelope(plaintext: string): Envelope {
  const root = parseXml(plaintext);
  const head = root.children.find((node) => node.name === "Head");
  const document = parseStatusDocument(plaintext);
  return {
    format: "xml",
    accessCode: textOf(head, "AccessCode"),
    checkword: textOf(head, "Checkword"),
    companyCode: firstCompanyCode(root),
    service: root.attributes.service,
    document,
  };
}

function firstCompanyCode(node: XmlNode): string | undefined {
  if (node.name === "CompanyCode" && node.text) return node.text;
  for (const child of node.children) {
    const found = firstCompanyCode(child);
    if (found) return found;
  }
  return undefined;
}

function readJsonEnvelope(plaintext: string): Envelope {
  const parsed = JSON.parse(plaintext) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("JSON push is not an object");
  }
  const record = parsed as Record<string, unknown>;
  const body =
    record.Body && typeof record.Body === "object" && !Array.isArray(record.Body)
      ? (record.Body as Record<string, unknown>)
      : record;
  const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined);
  return {
    format: "json",
    accessCode: text(record.AccessCode) ?? text(body.AccessCode),
    checkword: text(record.Checkword) ?? text(body.Checkword),
    companyCode: text(record.CompanyCode) ?? text(body.CompanyCode),
    service: text(record.ServiceCode) ?? text(body.ServiceCode),
    document: parseStatusDocument(plaintext),
  };
}

function readEnvelope(plaintext: string): Envelope {
  const trimmed = plaintext.trim();
  if (trimmed.startsWith("<")) return readXmlEnvelope(trimmed);
  if (trimmed.startsWith("{")) return readJsonEnvelope(trimmed);
  throw new Error("Push payload is neither XML nor JSON");
}

export async function handleOutboundStatusPush(input: {
  config: SfConfig;
  contentType: string | null;
  headers: PushHeaders;
  rawBody: string;
  admin: AdminGraphqlClient | null;
}): Promise<Response> {
  if (!contentTypeAllowed(input.contentType)) {
    return pushSystemErrorResponse(
      "xml",
      "Content-Type must be application/x-www-form-urlencoded.",
    );
  }
  if (input.headers.sysSource !== input.config.sysSource) {
    return pushSystemErrorResponse("xml", "sysSource does not match the cargo owner code.");
  }
  if (input.headers.serviceCode !== SERVICE_CODES.outboundStatusPush) {
    return pushSystemErrorResponse("xml", "serviceCode must be SALE_ORDER_STATUS_PUSH_SERVICE.");
  }

  const params = new URLSearchParams(input.rawBody);
  const plaintext = params.get("logistics_interface");
  const digest = params.get("data_digest");
  if (!plaintext || !digest) {
    return pushSystemErrorResponse("xml", "logistics_interface and data_digest are required.");
  }

  const format: "xml" | "json" = plaintext.trim().startsWith("{") ? "json" : "xml";
  const secrets = resolveSecrets(input.config);
  if (!secrets) {
    return pushSystemErrorResponse(format, "SF receiver credentials are not configured.");
  }
  const expected = dataDigest(plaintext, secrets.md5SpecialString);
  if (!secretEqual(expected, digest)) {
    return pushSystemErrorResponse(format, "data_digest does not match.");
  }

  let envelope: Envelope;
  try {
    envelope = readEnvelope(plaintext);
  } catch {
    return pushSystemErrorResponse(format, "The payload is not a 3.15 status document.");
  }
  if (envelope.service && envelope.service !== SERVICE_CODES.outboundStatusPush) {
    return pushSystemErrorResponse(envelope.format, "Service code in the payload is not 3.15.");
  }
  if (!envelope.accessCode || !secretEqual(envelope.accessCode, secrets.accessCode)) {
    return pushSystemErrorResponse(envelope.format, "Access Code does not match.");
  }
  if (!envelope.checkword || !secretEqual(envelope.checkword, secrets.checkword)) {
    return pushSystemErrorResponse(envelope.format, "Check Word does not match.");
  }
  if (envelope.companyCode !== input.config.companyCode) {
    return pushDataFailureResponse(envelope.format, "CompanyCode does not match the cargo owner code.");
  }
  if (input.config.rejectedCodeInUse) {
    return pushDataFailureResponse(envelope.format, "A refused cargo owner code is configured.");
  }
  if (envelope.document.orders.length === 0) {
    return pushDataFailureResponse(envelope.format, "The push did not include a sale order.");
  }
  if (envelope.document.orders.length > 20) {
    return pushSystemErrorResponse(envelope.format, "Batch size is above the spec limit of 20.");
  }
  const admin = input.admin;
  if (!admin) {
    return pushSystemErrorResponse(
      envelope.format,
      "The Shopify app is not installed, so tracking was not saved.",
    );
  }

  const results = await Promise.all(
    envelope.document.orders.map((order) => applyPushedOrder(order, input.config, admin)),
  );
  const applied = results.filter((result) => result.applied).length;
  if (applied === results.length) return pushOkResponse(envelope.format);
  const failed = results.find((result) => !result.applied);
  return pushDataFailureResponse(
    envelope.format,
    failed?.reason ?? `${applied} of ${results.length} orders were updated.`,
  );
}

async function applyPushedOrder(
  order: SfOutboundOrder,
  config: SfConfig,
  admin: AdminGraphqlClient,
): Promise<{ applied: boolean; reason: string }> {
  if (order.warehouseCode !== config.warehouseCode) {
    return {
      applied: false,
      reason: `WarehouseCode must be ${config.warehouseCode}.`,
    };
  }
  if (!order.wayBillNo) {
    return { applied: false, reason: "WayBillNo is missing." };
  }
  try {
    const lookup = await lookupTrackingOrder(admin, order.erpOrder ?? "", config.orderMatch);
    const plan = buildTrackingPlan(order, lookup, { notifyCustomer: config.notifyCustomer });
    const write = await applyTrackingPlan(admin, plan, true);
    return { applied: write.applied, reason: write.reason };
  } catch {
    return { applied: false, reason: "Shopify tracking update failed." };
  }
}
