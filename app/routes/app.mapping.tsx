import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { SF_BLOCKERS } from "../sf/blockers";
import { OUTBOUND_STATUS_CODES } from "../sf/status-codes";
import { FIELD_MAPPINGS } from "../shopify/tracking-plan";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export default function MappingPage() {
  return (
    <s-page heading="Field mapping">
      <s-banner heading="Unconfirmed mappings stay marked" tone="info">
        <s-paragraph>
          A waybill is written with fulfillmentTrackingInfoUpdate on an existing fulfillment.
          fulfillmentCreate is not used, because fulfilling line items can change inventory.
          Only orders whose financial status is PAID are eligible.
        </s-paragraph>
      </s-banner>

      <s-section heading="SF field to Shopify">
        <s-table>
          <s-table-header-row>
            <s-table-header listSlot="primary" format="base">SF field</s-table-header>
            <s-table-header listSlot="labeled" format="base">Shopify</s-table-header>
            <s-table-header listSlot="labeled" format="base">State</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {FIELD_MAPPINGS.map((row) => (
              <s-table-row key={row.sf}>
                <s-table-cell>{row.sf}</s-table-cell>
                <s-table-cell>{row.shopify}</s-table-cell>
                <s-table-cell>
                  <s-badge tone={row.state === "Unconfirmed" ? "warning" : "success"}>{row.state}</s-badge>
                </s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>

      <s-section heading="Status codes from the spec">
        <s-paragraph>
          3.16 step text and 3.15 data-status text are both shown. They do not always use the same words
          for the same code. These codes are not written to Shopify fulfillment events.
        </s-paragraph>
        <s-table>
          <s-table-header-row>
            <s-table-header listSlot="primary" format="base">Code</s-table-header>
            <s-table-header listSlot="labeled" format="base">3.16 query step</s-table-header>
            <s-table-header listSlot="labeled" format="base">3.15 push</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {OUTBOUND_STATUS_CODES.map((row) => (
              <s-table-row key={row.code}>
                <s-table-cell>{row.code}</s-table-cell>
                <s-table-cell>{row.queryStepStatus ?? "Not listed in 3.16"}</s-table-cell>
                <s-table-cell>{row.pushDataStatus ?? "Not listed in 3.15"}</s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>

      <s-section heading="Open blockers waiting on SF">
        {SF_BLOCKERS.map((blocker) => (
          <s-section key={blocker.id} heading={blocker.title}>
            <s-paragraph>{blocker.detail}</s-paragraph>
          </s-section>
        ))}
        <s-paragraph>
          The spec also says 3.15 and 3.16 are supported for the Baichuan OMS system. SF has not
          confirmed that path for warehouse 852DCTZ.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
