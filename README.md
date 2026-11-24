# Moola Meat tracking

Custom Shopify app for one store: **yhnbqk-zz.myshopify.com** (moolameat.com, HKD, Hong Kong). It is not an App Store listing.

This pass tracks SF Express SCC-OMS outbound status into Shopify fulfillments. It does not create item masters, inbound orders, outbound orders, or inventory adjustments, and it does not change prices or the theme.

The app scaffold is the official [Shopify React Router app template](https://github.com/Shopify/shopify-app-template-react-router) at commit `81eb98b6ca095eb0b92657f6007939a418f61955`, which Shopify CLI 5.0.2 selects for `shopify app init --template reactRouter`. `shopify app init` also creates the app in the Dev Dashboard and needs an interactive login, so this repo contains that template without a linked `client_id`. Link it with `shopify app config link` or `shopify app dev`.

## What is implemented

- Embedded admin app (Polaris web components and App Bridge) with the confirmed codes, connection settings, and a 3.16 status query action.
- SF SCC-OMS client: UTF-8 HTTP POST, `logistics_interface` plus `data_digest`, and `SALE_ORDER_STATUS_QUERY_SERVICE`.
- A 3.15 push receiver stub that stays unpublished.
- A Shopify tracking plan that attaches `WayBillNo` with `fulfillmentTrackingInfoUpdate` on an existing fulfillment of a paid order.

## What is not implemented

- Item Master (`ITEM_SERVICE` / 3.1), inbound, outbound order creation, cancellation, or inventory adjustments.
- Live calls to the SF gateway. `SF_LIVE_CALLS_ENABLED` defaults to false, and the client throws before `fetch` unless that flag is the string `true`.
- A callback URL for SF. The 3.15 route returns 404 until `SF_PUSH_RECEIVER_PUBLISHED=true`, and even then it does not acknowledge the push or update Shopify.
- `fulfillmentCreate`. Creating a fulfillment can change on-hand inventory, so orders with no fulfillment are left unchanged.

## Confirmed codes

| Role | Value |
| --- | --- |
| Cargo owner code, CompanyCode, sysSource, monthly card | `8526949142` |
| Warehouse code (warehouse only) | `852DCTZ` |

`8526936602` from an old template sheet is not the cargo owner code. The app refuses it if it is placed in the company, sysSource, monthly card, or warehouse settings.

## Local development

Requirements: Node.js 22.12 or newer, npm, and the [Shopify CLI](https://shopify.dev/docs/apps/tools/cli/getting-started).

```shell
npm install
cp .env.example .env
npm test
shopify app dev
```

`shopify app dev` loads `.env`, opens a tunnel, and installs the app. Put Shopify API credentials and SF credential values only in `.env` or the host's environment. `.env` is gitignored. `.env.example` has empty secret fields.

Do not set `SF_LIVE_CALLS_ENABLED=true` until the blockers below are resolved. Do not point a test at the SIT or production gateway from this repo's scripts. The unit tests use a mocked `fetch` and the spec's published signing example.

`npm run typecheck` and `npm run lint` check the app. `npm test` covers signing, the 3.16 request, the unpublished 3.15 stub, and the tracking plan.

## Install on yhnbqk-zz

1. Use a Dev Dashboard account that can install apps on `yhnbqk-zz.myshopify.com`.
2. From this directory run `shopify app config link` and choose **create a new app**, or run `shopify app dev` and accept creating the app. Name it Moola Meat tracking.
3. In the Dev Dashboard set distribution to **Custom** for this store. Do not submit the app to the App Store. The library auth mode stays `AppDistribution.AppStore` because that is the current Dev Dashboard install flow. `AppDistribution.SingleMerchant` is the older custom-app token flow and is not what `shopify app dev` uses.
4. Scopes in `shopify.app.toml` are `read_orders`, `read_merchant_managed_fulfillment_orders`, and `write_merchant_managed_fulfillment_orders`. There is no product, inventory, or theme scope.
5. Install the app on `yhnbqk-zz.myshopify.com`. The store login hint on the app's front page is that domain. `SHOP_CUSTOM_DOMAIN` defaults to `moolameat.com` so Shopify can recognise the store's own domain during auth.
6. Open the embedded app. The status query button stays disabled until the Access Code, Check Word, MD5 special string, and request URL are configured. Values are never shown in the admin. With live calls left off, submitting still does not contact SF.

## SF client

Transport follows the spec (PDF pages 16–18):

- HTTP POST, UTF-8.
- Body fields `logistics_interface` (raw XML or JSON) and `data_digest`.
- `data_digest` is the MD5 of the raw plaintext concatenated with the MD5 special string, as lowercase hex, then Base64 of that hex string. It is not Base64 of the raw MD5 bytes.
- XML `Head` contains `AccessCode` and `Checkword`. JSON puts `AccessCode`, `Checkword`, `ServiceCode`, and `CompanyCode` at the top level. Neither format has a `PassCode` field.
- Default `Content-Type` is `application/x-www-form-urlencoded`. Default placement of `sysSource` and `serviceCode` is the HTTP header, which is what the spec calls a request header. Payload format defaults to XML. All three are configurable because SF has not confirmed them.

Issued fields are `SF_ISSUED_ACCESS_CODE`, `SF_ISSUED_PASS_CODE`, and `SF_ISSUED_MD5_CHECKWORD`. The default map is AccessCode → spec Access Code, PassCode → spec Check Word, MD5 Checkword → MD5 special string. Change `SF_MAP_SPEC_ACCESS_CODE`, `SF_MAP_SPEC_CHECK_WORD`, and `SF_MAP_MD5_SPECIAL_STRING` if SF confirms a different map. Allowed values are `access_code`, `pass_code`, and `md5_checkword`.

SIT request URL, from the spec:

`https://portal-gateway.sit.sf-express.com:55443/scc-portal-api-service/omsPortalService/sendRequest`

Production host, from SF, with no path and no port:

`https://portal-gateway.sf-express.com`

`SF_PRODUCTION_REQUEST_URL` is empty. The client will not build a production URL by removing `.sit` or port `55443`, and it rejects those guesses if they are pasted into configuration. `SF_ENVIRONMENT=production` keeps the query disabled until a full HTTPS URL with a path is set.

3.16 is the usable path. The admin action builds `SALE_ORDER_STATUS_QUERY_SERVICE` for one `ErpOrder` and the confirmed warehouse code. Optional `ShipmentId` is included only when entered. The signed body is not returned to the browser and is not logged.

## Shopify tracking

| SF | Shopify | State |
| --- | --- | --- |
| `ErpOrder` | Order name, with or without `#`. `SHOPIFY_ORDER_MATCH=numeric_id` uses the numeric order id instead. | Unconfirmed |
| `WayBillNo` | `FulfillmentTrackingInput.number` | Waybill number from the spec |
| `Carrier` | Company sent as `SF Express` (a Shopify tracking company name). The raw code is kept on the plan and is not translated. | Unconfirmed |
| `labelUrl` | Not copied. The spec calls it a waybill URL, which may be a label rather than a customer tracking page. The tracking URL is left empty so Shopify can build one from company and number. | Unconfirmed |
| Status codes | Shown only. Not written as fulfillment events. | Unconfirmed |
| Financial status | Tracking is eligible only when `displayFinancialStatus` is `PAID`. | Partially paid is excluded on purpose |

`fulfillmentTrackingInfoUpdate` does not adjust inventory quantities. Customer notification stays off unless `SHOPIFY_NOTIFY_CUSTOMER=true`. The write itself stays off unless `SHOPIFY_TRACKING_WRITES_ENABLED=true`. Split orders (`IsSplit=Y`) and orders with more than one possible fulfillment are not updated.

Sections 3.13 and 3.17 are out of this pass.

## 3.15 receiver

`app/routes/sf.outbound-status.push.tsx` is an internal stub. It is not registered in `shopify.app.toml` and it is not a URL to give SF. Unpublished, it returns 404 and a plain-text explanation. The publish flag still returns 501, does not return the spec success result, and does not change a fulfillment. No callback URL has been issued.

## Open blockers waiting on SF

1. **Full production path and port.** Only the host `https://portal-gateway.sf-express.com` is confirmed.
2. **Credential field mapping.** PassCode does not appear in the spec. The default map above is likely and unconfirmed.
3. **Whether the issued credentials are the final set.** It is unconfirmed whether the three issued fields are final for SIT, production, or both.
4. **Content-Type and where `sysSource` / `serviceCode` go.** Defaults follow the documented form body and request headers.
5. **XML vs JSON.** The spec's general format is XML. 3.16 also has a JSON sample. The default is XML.
6. **PUSH URL not yet issued.** Daniel recommended push for route and status, with 3.16 query as the backup. No receiving URL has been given to SF.

The spec also says 3.15 and 3.16 are for the Baichuan OMS system. SF has not confirmed that path for warehouse `852DCTZ`.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm test` | Unit tests. No network calls. |
| `npm run typecheck` | React Router typegen and `tsc`. |
| `npm run lint` | ESLint. |
| `npm run dev` | `shopify app dev`. |
| `npm run build` | Production build. |
