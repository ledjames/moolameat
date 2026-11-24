/**
 * Confirmed Moola Meat codes and the only gateway addresses SF has given us.
 * Credential values do not belong in this file.
 */

/** Cargo owner / CompanyCode / sysSource / monthly card. Warehouse is separate. */
export const CONFIRMED_CARGO_OWNER_CODE = "8526949142";

/** Warehouse only. Not a customer code and not a cargo owner code. */
export const CONFIRMED_WAREHOUSE_CODE = "852DCTZ";

/**
 * Printed on an old template sheet. SF and James confirmed this is not the
 * cargo owner code. Configuration that uses it is refused.
 */
export const REJECTED_CARGO_OWNER_CODE = "8526936602";

/** Spec PDF p. 17. The only full request URL in the specification. */
export const SIT_REQUEST_URL =
  "https://portal-gateway.sit.sf-express.com:55443/scc-portal-api-service/omsPortalService/sendRequest";

/**
 * Production gateway host, from SF (Daniel Ng), verbatim.
 * Path and port were not provided. Do not append the SIT path or port.
 */
export const PRODUCTION_GATEWAY_HOST = "https://portal-gateway.sf-express.com";

export const SERVICE_CODES = {
  outboundStatusQuery: "SALE_ORDER_STATUS_QUERY_SERVICE",
  outboundStatusPush: "SALE_ORDER_STATUS_PUSH_SERVICE",
} as const;

export type ServiceCode = (typeof SERVICE_CODES)[keyof typeof SERVICE_CODES];

/** Shopify tracking company name from the Admin API company list. */
export const SHOPIFY_TRACKING_COMPANY = "SF Express";
