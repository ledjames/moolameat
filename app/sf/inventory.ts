import {
  INVENTORY_STATUS_GOOD,
  SERVICE_CODES,
} from "./constants";
import type { SfConfig } from "./config";
import { escapeXml, parseXml, textOf, xmlElement, type XmlNode } from "./xml";

export type InventoryQueryItem = {
  skuNo: string;
  lot?: string;
};

export type SfInventoryLine = {
  skuNo?: string;
  inventoryStatus?: string;
  lot?: string;
  expirationDate?: string;
  totalQty?: number;
  onHandQty?: number;
  availableQty?: number;
  inTransitQty?: number;
  result?: string;
  note?: string;
};

export type SfInventoryDocument = {
  format: "xml" | "json";
  head?: string;
  errorCode?: string;
  errorMessage?: string;
  companyCode?: string;
  warehouseCode?: string;
  lines: SfInventoryLine[];
};

function asString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function itemXml(item: InventoryQueryItem): string {
  return xmlElement(
    "RTInventory",
    xmlElement("SkuNo", escapeXml(item.skuNo)) +
      (item.lot ? xmlElement("Lot", escapeXml(item.lot)) : ""),
  );
}

export function buildInventoryQueryMessage(
  config: SfConfig,
  accessCode: string,
  checkword: string,
  input: { items: InventoryQueryItem[]; inventoryStatus?: string },
): string {
  const status = input.inventoryStatus ?? INVENTORY_STATUS_GOOD;
  if (config.payloadFormat === "json") {
    return JSON.stringify({
      CompanyCode: config.companyCode,
      WarehouseCode: config.warehouseCode,
      InventoryStatus: status,
      AccessCode: accessCode,
      Checkword: checkword,
      ServiceCode: SERVICE_CODES.inventoryQuery,
      RTInventorys: input.items.map((item) => {
        const row: Record<string, string> = { SkuNo: item.skuNo };
        if (item.lot) row.Lot = item.lot;
        return row;
      }),
    });
  }

  const body = xmlElement(
    "Body",
    xmlElement(
      "RTInventoryQueryRequest",
      xmlElement("CompanyCode", escapeXml(config.companyCode)) +
        xmlElement("WarehouseCode", escapeXml(config.warehouseCode)) +
        xmlElement("InventoryStatus", escapeXml(status)) +
        xmlElement("RTInventorys", input.items.map(itemXml).join("")),
    ),
  );
  const head = xmlElement(
    "Head",
    xmlElement("AccessCode", escapeXml(accessCode)) + xmlElement("Checkword", escapeXml(checkword)),
  );
  return xmlElement("Request", head + body, {
    service: SERVICE_CODES.inventoryQuery,
    lang: config.lang,
  });
}

function child(node: XmlNode | undefined, name: string): XmlNode | undefined {
  return node?.children.find((entry) => entry.name === name);
}

function childrenNamed(node: XmlNode | undefined, name: string): XmlNode[] {
  return node?.children.filter((entry) => entry.name === name) ?? [];
}

function lineFromHeader(header: XmlNode | undefined, result?: string, note?: string): SfInventoryLine {
  return {
    skuNo: textOf(header, "SkuNo"),
    inventoryStatus: textOf(header, "InventoryStatus"),
    lot: textOf(header, "Lot"),
    expirationDate: textOf(header, "ExpirationDate"),
    totalQty: asNumber(textOf(header, "TotalQty")),
    onHandQty: asNumber(textOf(header, "OnHandQty")),
    availableQty: asNumber(textOf(header, "AvailableQty")),
    inTransitQty: asNumber(textOf(header, "InTransitQty")),
    result,
    note,
  };
}

export function parseInventoryXml(source: string): SfInventoryDocument {
  const root = parseXml(source);
  const error = child(root, "Error");
  const response = child(child(root, "Body"), "RTInventoryQueryResponse");
  const lines = childrenNamed(child(response, "RTInventorys"), "RTInventory").map((item) =>
    lineFromHeader(child(item, "Header"), textOf(item, "Result"), textOf(item, "Note")),
  );
  return {
    format: "xml",
    head: textOf(root, "Head"),
    errorCode: error?.attributes.code,
    errorMessage: error?.text || undefined,
    companyCode: textOf(response, "CompanyCode"),
    warehouseCode: textOf(response, "WarehouseCode"),
    lines,
  };
}

function lineFromJson(record: Record<string, unknown>): SfInventoryLine {
  const header =
    record.Header && typeof record.Header === "object" && !Array.isArray(record.Header)
      ? (record.Header as Record<string, unknown>)
      : record;
  return {
    skuNo: asString(header.SkuNo),
    inventoryStatus: asString(header.InventoryStatus),
    lot: asString(header.Lot),
    expirationDate: asString(header.ExpirationDate),
    totalQty: asNumber(header.TotalQty),
    onHandQty: asNumber(header.OnHandQty),
    availableQty: asNumber(header.AvailableQty),
    inTransitQty: asNumber(header.InTransitQty),
    result: asString(record.Result),
    note: asString(record.Note),
  };
}

export function parseInventoryJson(source: string): SfInventoryDocument {
  const parsed = JSON.parse(source) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Inventory JSON is not an object");
  }
  const root = parsed as Record<string, unknown>;
  const rows = Array.isArray(root.RTInventorys) ? root.RTInventorys : [];
  return {
    format: "json",
    head: asString(root.Head),
    errorMessage: asString(root.ErrorMsg),
    companyCode: asString(root.CompanyCode),
    warehouseCode: asString(root.WarehouseCode),
    lines: rows
      .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
      .map(lineFromJson),
  };
}

export function parseInventoryDocument(raw: string): SfInventoryDocument {
  const payload = raw.trim();
  if (payload.startsWith("<")) return parseInventoryXml(payload);
  if (payload.startsWith("{")) return parseInventoryJson(payload);
  throw new Error("Inventory document is neither XML nor JSON");
}

export function goodStockAvailable(lines: SfInventoryLine[], sku: string): number | null {
  const matches = lines.filter(
    (line) => line.skuNo === sku && line.inventoryStatus === INVENTORY_STATUS_GOOD && line.availableQty !== undefined,
  );
  if (matches.length === 0) return null;
  return matches.reduce((sum, line) => sum + (line.availableQty ?? 0), 0);
}
