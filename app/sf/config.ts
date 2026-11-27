import {
  CONFIRMED_CARGO_OWNER_CODE,
  CONFIRMED_WAREHOUSE_CODE,
  PRODUCTION_GATEWAY_HOST,
  REJECTED_CARGO_OWNER_CODE,
  SIT_REQUEST_URL,
} from "./constants";

export const ISSUED_FIELDS = ["access_code", "pass_code", "md5_checkword"] as const;
export type IssuedField = (typeof ISSUED_FIELDS)[number];

export type PayloadFormat = "xml" | "json";
export type FieldPlacement = "header" | "form" | "both";
export type SfEnvironment = "sit" | "production";
export type OrderMatchMode = "order_name" | "numeric_id";

export type SfConfig = {
  environment: SfEnvironment;
  sitRequestUrl: string;
  /** Empty until SF confirms the full production path and port. */
  productionRequestUrl: string;
  productionGatewayHost: string;
  requestUrlOverride: string;
  payloadFormat: PayloadFormat;
  /** Unconfirmed. Default matches the spec's form body. */
  contentType: string;
  /** Spec says request header. Placement is still unconfirmed by SF. */
  sysSourcePlacement: FieldPlacement;
  serviceCodePlacement: FieldPlacement;
  lang: string;
  companyCode: string;
  sysSource: string;
  monthlyCard: string;
  warehouseCode: string;
  includeWarehouseOnQuery: boolean;
  issued: Record<IssuedField, string>;
  /**
   * Likely but unconfirmed: AccessCode → spec Access Code,
   * PassCode → spec Check Word, MD5 Checkword → MD5 special string.
   */
  mapping: {
    specAccessCode: IssuedField;
    specCheckWord: IssuedField;
    md5SpecialString: IssuedField;
  };
  liveCallsEnabled: boolean;
  orderMatch: OrderMatchMode;
  notifyCustomer: boolean;
  trackingWritesEnabled: boolean;
  rejectedCodeInUse: string | null;
};

const DEFAULT_CONTENT_TYPE = "application/x-www-form-urlencoded";

function pick<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  const trimmed = value?.trim();
  if (trimmed && (allowed as readonly string[]).includes(trimmed)) return trimmed as T;
  return fallback;
}

function flag(value: string | undefined): boolean {
  return value?.trim() === "true";
}

export function loadSfConfig(env: NodeJS.ProcessEnv = process.env): SfConfig {
  const companyCode = env.SF_COMPANY_CODE?.trim() || CONFIRMED_CARGO_OWNER_CODE;
  const sysSource = env.SF_SYS_SOURCE?.trim() || CONFIRMED_CARGO_OWNER_CODE;
  const monthlyCard = env.SF_MONTHLY_CARD?.trim() || CONFIRMED_CARGO_OWNER_CODE;
  const warehouseCode = env.SF_WAREHOUSE_CODE?.trim() || CONFIRMED_WAREHOUSE_CODE;
  const issued = {
    access_code: env.SF_ISSUED_ACCESS_CODE ?? "",
    pass_code: env.SF_ISSUED_PASS_CODE ?? "",
    md5_checkword: env.SF_ISSUED_MD5_CHECKWORD ?? "",
  };
  const codes = [companyCode, sysSource, monthlyCard, warehouseCode];
  const rejected = codes.find((code) => code === REJECTED_CARGO_OWNER_CODE) ?? null;

  return {
    environment: pick(env.SF_ENVIRONMENT, ["sit", "production"] as const, "sit"),
    sitRequestUrl: env.SF_SIT_REQUEST_URL?.trim() || SIT_REQUEST_URL,
    productionRequestUrl: env.SF_PRODUCTION_REQUEST_URL?.trim() ?? "",
    productionGatewayHost: PRODUCTION_GATEWAY_HOST,
    requestUrlOverride: env.SF_REQUEST_URL?.trim() ?? "",
    payloadFormat: pick(env.SF_PAYLOAD_FORMAT, ["xml", "json"] as const, "xml"),
    contentType: env.SF_CONTENT_TYPE?.trim() || DEFAULT_CONTENT_TYPE,
    sysSourcePlacement: pick(
      env.SF_SYS_SOURCE_PLACEMENT,
      ["header", "form", "both"] as const,
      "header",
    ),
    serviceCodePlacement: pick(
      env.SF_SERVICE_CODE_PLACEMENT,
      ["header", "form", "both"] as const,
      "header",
    ),
    lang: env.SF_LANG?.trim() || "zh-CN",
    companyCode,
    sysSource,
    monthlyCard,
    warehouseCode,
    includeWarehouseOnQuery: env.SF_INCLUDE_WAREHOUSE_ON_QUERY?.trim() !== "false",
    issued,
    mapping: {
      specAccessCode: pick(env.SF_MAP_SPEC_ACCESS_CODE, ISSUED_FIELDS, "access_code"),
      specCheckWord: pick(env.SF_MAP_SPEC_CHECK_WORD, ISSUED_FIELDS, "pass_code"),
      md5SpecialString: pick(env.SF_MAP_MD5_SPECIAL_STRING, ISSUED_FIELDS, "md5_checkword"),
    },
    liveCallsEnabled: flag(env.SF_LIVE_CALLS_ENABLED),
    orderMatch: pick(env.SHOPIFY_ORDER_MATCH, ["order_name", "numeric_id"] as const, "order_name"),
    notifyCustomer: flag(env.SHOPIFY_NOTIFY_CUSTOMER),
    trackingWritesEnabled: flag(env.SHOPIFY_TRACKING_WRITES_ENABLED),
    rejectedCodeInUse: rejected,
  };
}

export type ResolvedSecrets = {
  accessCode: string;
  checkword: string;
  md5SpecialString: string;
};

export function issuedValue(config: SfConfig, field: IssuedField): string {
  return config.issued[field].trim();
}

export function resolveSecrets(config: SfConfig): ResolvedSecrets | null {
  const accessCode = issuedValue(config, config.mapping.specAccessCode);
  const checkword = issuedValue(config, config.mapping.specCheckWord);
  const md5SpecialString = issuedValue(config, config.mapping.md5SpecialString);
  if (!accessCode || !checkword || !md5SpecialString) return null;
  return { accessCode, checkword, md5SpecialString };
}

/**
 * URLs produced by editing the documented SIT URL. They are not endpoints.
 * SF has not confirmed any of them.
 */
export function unconfirmedProductionGuesses(sitRequestUrl = SIT_REQUEST_URL): string[] {
  const sit = new URL(sitRequestUrl);
  const host = sit.hostname.replace(/\.sit(?=\.)/, "");
  const dropSit = new URL(sitRequestUrl);
  dropSit.hostname = host;
  const dropPort = new URL(sitRequestUrl);
  dropPort.port = "";
  const dropBoth = new URL(sitRequestUrl);
  dropBoth.hostname = host;
  dropBoth.port = "";
  return [dropSit, dropPort, dropBoth].map((url) => url.toString());
}

export type RequestUrlResult =
  | { ok: true; url: string }
  | { ok: false; reason: string };

function normalizeUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    url.hash = "";
    url.search = "";
    if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.replace(/\/+$/, "");
    }
    return url;
  } catch {
    return null;
  }
}

function isHostOnly(url: URL): boolean {
  return url.pathname === "" || url.pathname === "/";
}

export function classifyRequestUrl(raw: string, environment: SfEnvironment, sitRequestUrl: string): RequestUrlResult {
  const url = normalizeUrl(raw.trim());
  if (!url) {
    return { ok: false, reason: "Request URL must be an absolute HTTPS URL." };
  }
  const serialized = url.toString();
  const guesses = new Set(unconfirmedProductionGuesses(sitRequestUrl).map((guess) => new URL(guess).toString()));
  if (guesses.has(serialized)) {
    return {
      ok: false,
      reason:
        "This URL is an unconfirmed guess made by removing .sit from the SIT host and/or dropping port 55443. The production path and port stay unset until SF confirms them.",
    };
  }
  if (environment === "production" && serialized === new URL(sitRequestUrl).toString()) {
    return { ok: false, reason: "The SIT test URL is not the production request URL." };
  }
  if (isHostOnly(url)) {
    return {
      ok: false,
      reason: `The gateway host ${url.origin} has no confirmed path or port. This app will not invent them.`,
    };
  }
  return { ok: true, url: serialized };
}

export function resolveRequestUrl(config: SfConfig): RequestUrlResult {
  if (config.requestUrlOverride) {
    return classifyRequestUrl(config.requestUrlOverride, config.environment, config.sitRequestUrl);
  }
  if (config.environment === "sit") {
    return classifyRequestUrl(config.sitRequestUrl, "sit", config.sitRequestUrl);
  }
  if (!config.productionRequestUrl) {
    return {
      ok: false,
      reason: `Production request URL is not set. SF confirmed the host ${config.productionGatewayHost} only. Path and port are unconfirmed.`,
    };
  }
  return classifyRequestUrl(config.productionRequestUrl, "production", config.sitRequestUrl);
}

export type QueryGate = {
  enabled: boolean;
  reasons: string[];
};

export function queryGate(config: SfConfig): QueryGate {
  const reasons: string[] = [];
  if (config.rejectedCodeInUse) {
    reasons.push(
      `${REJECTED_CARGO_OWNER_CODE} is not the cargo owner code. Remove it from the SF code settings.`,
    );
  }
  const secrets = resolveSecrets(config);
  if (!secrets) {
    const missing: string[] = [];
    if (!issuedValue(config, config.mapping.specAccessCode)) {
      missing.push(`spec Access Code (issued field ${config.mapping.specAccessCode})`);
    }
    if (!issuedValue(config, config.mapping.specCheckWord)) {
      missing.push(`spec Check Word (issued field ${config.mapping.specCheckWord})`);
    }
    if (!issuedValue(config, config.mapping.md5SpecialString)) {
      missing.push(`MD5 special string (issued field ${config.mapping.md5SpecialString})`);
    }
    reasons.push(`Credentials are not configured: ${missing.join("; ")}.`);
  }
  const url = resolveRequestUrl(config);
  if (!url.ok) reasons.push(url.reason);
  return { enabled: reasons.length === 0, reasons };
}

export type PublicConnection = {
  environment: SfEnvironment;
  companyCode: string;
  sysSource: string;
  monthlyCard: string;
  warehouseCode: string;
  payloadFormat: PayloadFormat;
  contentType: string;
  sysSourcePlacement: FieldPlacement;
  serviceCodePlacement: FieldPlacement;
  lang: string;
  mapping: SfConfig["mapping"];
  issuedPresent: Record<IssuedField, boolean>;
  specFieldsPresent: {
    accessCode: boolean;
    checkWord: boolean;
    md5SpecialString: boolean;
  };
  sharedIssuedField: boolean;
  requestUrl: RequestUrlResult;
  sitRequestUrl: string;
  productionGatewayHost: string;
  productionRequestUrlConfigured: boolean;
  liveCallsEnabled: boolean;
  orderMatch: OrderMatchMode;
  notifyCustomer: boolean;
  trackingWritesEnabled: boolean;
  includeWarehouseOnQuery: boolean;
  query: QueryGate;
  rejectedCodeInUse: string | null;
};

export function toPublicConnection(config: SfConfig): PublicConnection {
  const secrets = resolveSecrets(config);
  const sources = [
    config.mapping.specAccessCode,
    config.mapping.specCheckWord,
    config.mapping.md5SpecialString,
  ];
  return {
    environment: config.environment,
    companyCode: config.companyCode,
    sysSource: config.sysSource,
    monthlyCard: config.monthlyCard,
    warehouseCode: config.warehouseCode,
    payloadFormat: config.payloadFormat,
    contentType: config.contentType,
    sysSourcePlacement: config.sysSourcePlacement,
    serviceCodePlacement: config.serviceCodePlacement,
    lang: config.lang,
    mapping: config.mapping,
    issuedPresent: {
      access_code: issuedValue(config, "access_code").length > 0,
      pass_code: issuedValue(config, "pass_code").length > 0,
      md5_checkword: issuedValue(config, "md5_checkword").length > 0,
    },
    specFieldsPresent: {
      accessCode: Boolean(secrets?.accessCode),
      checkWord: Boolean(secrets?.checkword),
      md5SpecialString: Boolean(secrets?.md5SpecialString),
    },
    sharedIssuedField: new Set(sources).size !== sources.length,
    requestUrl: resolveRequestUrl(config),
    sitRequestUrl: config.sitRequestUrl,
    productionGatewayHost: config.productionGatewayHost,
    productionRequestUrlConfigured: config.productionRequestUrl.length > 0,
    liveCallsEnabled: config.liveCallsEnabled,
    orderMatch: config.orderMatch,
    notifyCustomer: config.notifyCustomer,
    trackingWritesEnabled: config.trackingWritesEnabled,
    includeWarehouseOnQuery: config.includeWarehouseOnQuery,
    query: queryGate(config),
    rejectedCodeInUse: config.rejectedCodeInUse,
  };
}
