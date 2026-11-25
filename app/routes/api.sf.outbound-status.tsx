import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { loadSfConfig } from "../sf/config";
import { handleOutboundStatusPush, pushMethodNotAllowedResponse } from "../sf/receive-push";
import { MOOLA_STORE } from "../shopify/store";
import { unauthenticated } from "../shopify.server";
import type { AdminGraphqlClient } from "../shopify/apply-tracking";

/**
 * Public SCC-OMS 3.15 receiver. SF Express posts here.
 * There is no Shopify admin session on this request.
 * SF_LIVE_CALLS_ENABLED does not apply: that flag gates calls we make to SF.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  void request;
  return pushMethodNotAllowedResponse();
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const config = loadSfConfig();
  let admin: AdminGraphqlClient | null = null;
  try {
    const context = await unauthenticated.admin(MOOLA_STORE.shopDomain);
    admin = context.admin;
  } catch {
    admin = null;
  }
  return handleOutboundStatusPush({
    config,
    contentType: request.headers.get("content-type"),
    headers: {
      sysSource: request.headers.get("syssource"),
      serviceCode: request.headers.get("servicecode"),
    },
    rawBody: await request.text(),
    admin,
  });
};
