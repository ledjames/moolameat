import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { loadSfConfig } from "../sf/config";
import { publishedStubResponse, unpublishedPushResponse } from "../sf/push-receiver";

/**
 * Internal 3.15 stub. Not a callback URL for SF Express.
 * Unpublished installs respond 404 and do not parse the body into Shopify.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  void request;
  return unpublishedPushResponse();
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const config = loadSfConfig();
  if (!config.pushReceiverPublished) return unpublishedPushResponse();
  const raw = await request.text();
  return publishedStubResponse(raw, request.headers.get("content-type"));
};
