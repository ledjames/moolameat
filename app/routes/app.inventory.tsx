import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { parseSkuList } from "../inventory/compare";
import { runInventoryPreview } from "../inventory/preview";
import { loadSfConfig, toPublicConnection } from "../sf/config";
import { CONFIRMED_CARGO_OWNER_CODE, CONFIRMED_WAREHOUSE_CODE, INVENTORY_STATUS_GOOD } from "../sf/constants";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return { connection: toPublicConnection(loadSfConfig()) };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const form = await request.formData();
  const parsed = parseSkuList(String(form.get("skus") ?? ""));
  if ("error" in parsed) return { ok: false as const, error: parsed.error };
  return runInventoryPreview({
    config: loadSfConfig(),
    skus: parsed.skus,
    admin,
  });
};

function matchLabel(match: string): string {
  if (match === "matched") return "Matched";
  if (match === "sf_only") return "SF only";
  if (match === "shopify_only") return "Shopify only";
  if (match === "none") return "No match";
  return "SF not queried";
}

export default function InventoryPreview() {
  const { connection } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const result = fetcher.data;
  const submitting = fetcher.state !== "idle";

  return (
    <s-page heading="Warehouse inventory">
      <s-banner heading="Read only" tone="info">
        <s-paragraph>
          Compares SF 3.18 Good Stock AvailableQty with Shopify available quantity for the same SKU.
          This screen does not write inventory, prices, or the theme, and it does not call
          RT_INVENTORY_PUSH_SERVICE.
        </s-paragraph>
      </s-banner>
      {!connection.liveCallsEnabled ? (
        <s-banner heading="SF inventory query is not live" tone="warning">
          <s-paragraph>
            SF_LIVE_CALLS_ENABLED is not true. Submitting does not contact SF Express. Shopify
            quantities can still be shown for the SKUs you enter. AvailableQty stays blank until a
            live query is allowed.
          </s-paragraph>
        </s-banner>
      ) : null}
      {!connection.query.enabled ? (
        <s-banner heading="Query disabled" tone="warning">
          <s-unordered-list>
            {connection.query.reasons.map((reason) => (
              <s-list-item key={reason}>{reason}</s-list-item>
            ))}
          </s-unordered-list>
        </s-banner>
      ) : null}

      <s-section heading="Codes">
        <s-paragraph>
          CompanyCode {CONFIRMED_CARGO_OWNER_CODE}. Warehouse {CONFIRMED_WAREHOUSE_CODE}. Inventory
          status {INVENTORY_STATUS_GOOD} (Good Stock). Service RT_INVENTORY_QUERY_SERVICE. 3.18 is
          described as Baichuan OMS only, the same caveat as outbound status.
        </s-paragraph>
        <s-paragraph>
          New read scopes (read_products, read_inventory, read_locations) need an app update and
          re-authorization before live Shopify quantities load. No write_inventory scope is requested.
        </s-paragraph>
      </s-section>

      <s-section heading="Compare SKUs">
        <fetcher.Form method="post">
          <s-stack direction="block" gap="base">
            <s-text-area
              label="SKUs"
              name="skus"
              rows={4}
              details="One item code per line, up to 20. Sent as SkuNo and matched to the Shopify variant SKU. No SKU map is invented."
            ></s-text-area>
            <s-button
              type="submit"
              variant="primary"
              disabled={!connection.query.enabled || submitting}
              loading={submitting}
            >
              Compare good stock
            </s-button>
          </s-stack>
        </fetcher.Form>
        {result && !result.ok ? (
          <s-banner heading="Comparison was not run" tone="critical">
            <s-paragraph>{result.error}</s-paragraph>
          </s-banner>
        ) : null}
        {result && result.ok && !result.sent ? (
          <s-banner heading="SF was not queried" tone="info">
            <s-paragraph>{result.reason}</s-paragraph>
          </s-banner>
        ) : null}
        {result && result.ok && result.sent ? (
          <s-paragraph>
            SF head {result.head ?? "absent"}. {result.parseError ?? result.errorMessage ?? "Response parsed."}
          </s-paragraph>
        ) : null}
        {result && result.ok && result.warehouseNote ? (
          <s-paragraph>{result.warehouseNote}</s-paragraph>
        ) : null}
        {result && result.ok && result.shopifyError ? (
          <s-banner heading="Shopify quantities were not read" tone="warning">
            <s-paragraph>
              {result.shopifyError} If this is an access error, release the new read scopes and
              re-authorize the app. Stock was not changed.
            </s-paragraph>
          </s-banner>
        ) : null}
        {result && result.ok ? (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary" format="base">SKU</s-table-header>
              <s-table-header listSlot="labeled" format="numeric">SF available</s-table-header>
              <s-table-header listSlot="labeled" format="numeric">Shopify available</s-table-header>
              <s-table-header listSlot="labeled" format="base">Match</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {result.comparison.map((row) => (
                <s-table-row key={row.sku}>
                  <s-table-cell>{row.sku}</s-table-cell>
                  <s-table-cell>{row.sfAvailable === null ? "—" : String(row.sfAvailable)}</s-table-cell>
                  <s-table-cell>{row.shopifyAvailable === null ? "—" : String(row.shopifyAvailable)}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={row.match === "matched" ? "success" : "warning"}>{matchLabel(row.match)}</s-badge>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        ) : null}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
