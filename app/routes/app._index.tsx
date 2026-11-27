import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { loadSfConfig, toPublicConnection } from "../sf/config";
import { SF_BLOCKERS } from "../sf/blockers";
import { OUTBOUND_STATUS_PUSH_PATH } from "../sf/constants";
import { MOOLA_STORE } from "../shopify/store";
import { runStatusQuery } from "../tracking/query-action";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return {
    store: MOOLA_STORE,
    connection: toPublicConnection(loadSfConfig()),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const form = await request.formData();
  return runStatusQuery({
    config: loadSfConfig(),
    erpOrder: String(form.get("erpOrder") ?? ""),
    shipmentId: String(form.get("shipmentId") ?? ""),
    admin,
  });
};

function Presence({ set }: { set: boolean }) {
  return <s-badge tone={set ? "success" : "warning"}>{set ? "Set" : "Missing"}</s-badge>;
}

export default function TrackingHome() {
  const { store: shop, connection: view } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const result = fetcher.data;
  const submitting = fetcher.state !== "idle";

  return (
    <s-page heading="SF Express tracking">
      <s-banner heading="Tracking only" tone="info">
        <s-paragraph>
          This app reads outbound status from SF SCC-OMS and can attach a waybill to an
          existing Shopify fulfillment. It does not change inventory quantities, prices, or the theme.
        </s-paragraph>
      </s-banner>

      <s-section heading="Store">
        <s-paragraph>
          {shop.shopDomain} · {shop.customDomain} · {shop.currency} · {shop.region}
        </s-paragraph>
        <s-paragraph>Custom app for this store. Not an App Store listing.</s-paragraph>
      </s-section>

      <s-section heading="Confirmed codes">
        <s-table>
          <s-table-header-row>
            <s-table-header listSlot="primary" format="base">Field</s-table-header>
            <s-table-header listSlot="labeled" format="base">Value</s-table-header>
          </s-table-header-row>
          <s-table-body>
            <s-table-row>
              <s-table-cell>Cargo owner / CompanyCode / sysSource / monthly card</s-table-cell>
              <s-table-cell>{view.companyCode}</s-table-cell>
            </s-table-row>
            <s-table-row>
              <s-table-cell>Warehouse code</s-table-cell>
              <s-table-cell>{view.warehouseCode}</s-table-cell>
            </s-table-row>
          </s-table-body>
        </s-table>
        <s-paragraph>
          Company code {view.companyCode}, sysSource {view.sysSource}, monthly card {view.monthlyCard}.
          Warehouse {view.warehouseCode} is warehouse only.
        </s-paragraph>
      </s-section>

      <s-section heading="Connection">
        {view.rejectedCodeInUse ? (
          <s-banner heading="Rejected code in configuration" tone="critical">
            <s-paragraph>
              {view.rejectedCodeInUse} is not the cargo owner code. The status query stays disabled.
            </s-paragraph>
          </s-banner>
        ) : null}
        <s-paragraph>
          Environment: {view.environment}. Payload: {view.payloadFormat}. Content-Type: {view.contentType}.
          sysSource placement: {view.sysSourcePlacement}. serviceCode placement: {view.serviceCodePlacement}.
          Language: {view.lang}.
        </s-paragraph>
        <s-paragraph>
          SIT request URL (from the spec): {view.sitRequestUrl}
        </s-paragraph>
        <s-paragraph>
          Production gateway host (path and port unconfirmed): {view.productionGatewayHost}
        </s-paragraph>
        <s-paragraph>
          {view.requestUrl.ok
            ? `Request URL in use: ${view.requestUrl.url}`
            : `Request URL is not usable. ${view.requestUrl.reason}`}
        </s-paragraph>
        <s-unordered-list>
          <s-list-item>
            Issued AccessCode <Presence set={view.issuedPresent.access_code} /> maps to spec Access Code ({view.mapping.specAccessCode}){" "}
            <Presence set={view.specFieldsPresent.accessCode} />
          </s-list-item>
          <s-list-item>
            Issued PassCode <Presence set={view.issuedPresent.pass_code} /> maps to spec Check Word ({view.mapping.specCheckWord}){" "}
            <Presence set={view.specFieldsPresent.checkWord} />
          </s-list-item>
          <s-list-item>
            Issued MD5 Checkword <Presence set={view.issuedPresent.md5_checkword} /> maps to the MD5 special string ({view.mapping.md5SpecialString}){" "}
            <Presence set={view.specFieldsPresent.md5SpecialString} />
          </s-list-item>
        </s-unordered-list>
        {view.sharedIssuedField ? (
          <s-banner heading="Credential mapping overlaps" tone="warning">
            <s-paragraph>
              Two spec fields use the same issued credential. The default mapping is likely and still unconfirmed.
            </s-paragraph>
          </s-banner>
        ) : null}
        <s-paragraph>
          Live calls to SF: {view.liveCallsEnabled ? "enabled" : "off"}. That flag does not gate
          inbound 3.15 pushes. Admin query writes: {view.trackingWritesEnabled ? "enabled" : "off"}.
        </s-paragraph>
        <s-paragraph>
          3.15 push path: {OUTBOUND_STATUS_PUSH_PATH}. The host is SHOPIFY_APP_URL after deploy.
          No public hostname is configured in this app.
        </s-paragraph>
      </s-section>

      <s-section heading="Outbound status query">
        <s-paragraph>
          Service SALE_ORDER_STATUS_QUERY_SERVICE (spec 3.16). The button stays disabled until the
          Access Code, Check Word, MD5 special string, and request URL are all configured.
        </s-paragraph>
        {!view.liveCallsEnabled ? (
          <s-banner heading="No call is sent to SF" tone="info">
            <s-paragraph>
              SF_LIVE_CALLS_ENABLED is not true. Submitting builds the signed request in memory and
              does not contact the gateway.
            </s-paragraph>
          </s-banner>
        ) : null}
        {!view.query.enabled ? (
          <s-banner heading="Query disabled" tone="warning">
            <s-unordered-list>
              {view.query.reasons.map((reason) => (
                <s-list-item key={reason}>{reason}</s-list-item>
              ))}
            </s-unordered-list>
          </s-banner>
        ) : null}
        <fetcher.Form method="post">
          <s-stack direction="block" gap="base">
            <s-text-field
              label="ERP order number"
              name="erpOrder"
              required
              maxLength={64}
              details="Sent as ErpOrder. How this matches a Shopify order is unconfirmed."
            ></s-text-field>
            <s-text-field
              label="Shipment id"
              name="shipmentId"
              maxLength={64}
              details="Optional SF outbound order number."
            ></s-text-field>
            <s-button
              type="submit"
              variant="primary"
              disabled={!view.query.enabled || submitting}
              loading={submitting}
            >
              Query outbound status
            </s-button>
          </s-stack>
        </fetcher.Form>
        {result && !result.ok ? (
          <s-banner heading="Query was not sent" tone="critical">
            <s-paragraph>{result.error}</s-paragraph>
          </s-banner>
        ) : null}
        {result && result.ok && !result.sent ? (
          <s-banner heading="Request not sent" tone="info">
            <s-paragraph>
              {result.reason} Service {result.serviceCode}. Environment {result.environment}. ERP order {result.erpOrder}.
            </s-paragraph>
          </s-banner>
        ) : null}
        {result && result.ok && result.sent ? (
          <s-section heading="SF response">
            <s-paragraph>
              HTTP {result.httpStatus}. Head {result.head ?? "absent"}. {result.shopifyWrite.reason}
            </s-paragraph>
            {result.parseError ? <s-paragraph>{result.parseError}</s-paragraph> : null}
            {result.orders.map((order) => (
              <s-paragraph key={`${order.erpOrder ?? "order"}-${order.wayBillNo ?? "none"}`}>
                ErpOrder {order.erpOrder ?? "absent"}. Waybill {order.wayBillNo ?? "absent"}. Status{" "}
                {order.orderStatus ?? "absent"}. Carrier {order.carrier ?? "absent"}.
              </s-paragraph>
            ))}
            {result.plan ? (
              <s-paragraph>
                Plan: {result.plan.action}. Inventory impact: {result.plan.inventoryImpact}.
                {result.plan.blockReason ? ` ${result.plan.blockReason}` : ""}
              </s-paragraph>
            ) : null}
          </s-section>
        ) : null}
      </s-section>

      <s-section heading="Waiting on SF">
        <s-unordered-list>
          {SF_BLOCKERS.map((blocker) => (
            <s-list-item key={blocker.id}>{blocker.title}</s-list-item>
          ))}
        </s-unordered-list>
        <s-link href="/app/mapping">Field mapping and blocker detail</s-link>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
