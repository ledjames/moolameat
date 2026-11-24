import { SERVICE_CODES } from "./constants";
import { resolveRequestUrl, resolveSecrets, type SfConfig } from "./config";
import { buildStatusQueryMessage, wrapSignedRequest, type PreparedSfRequest } from "./messages";
import { dataDigest } from "./sign";

export class SfLiveCallsDisabledError extends Error {
  constructor() {
    super("SF live calls are disabled. No HTTP request was made.");
    this.name = "SfLiveCallsDisabledError";
  }
}

export class SfRequestNotReadyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SfRequestNotReadyError";
  }
}

export function prepareStatusQuery(
  config: SfConfig,
  input: { erpOrder: string; shipmentId?: string },
): PreparedSfRequest {
  const secrets = resolveSecrets(config);
  if (!secrets) {
    throw new SfRequestNotReadyError("SF credentials are not configured.");
  }
  const url = resolveRequestUrl(config);
  if (!url.ok) throw new SfRequestNotReadyError(url.reason);

  const plaintext = buildStatusQueryMessage(
    config,
    secrets.accessCode,
    secrets.checkword,
    {
      erpOrder: input.erpOrder,
      shipmentId: input.shipmentId?.trim() || undefined,
      warehouseCode: config.warehouseCode,
    },
  );
  return wrapSignedRequest({
    url: url.url,
    plaintext,
    digest: dataDigest(plaintext, secrets.md5SpecialString),
    serviceCode: SERVICE_CODES.outboundStatusQuery,
    config,
  });
}

export async function sendPreparedRequest(
  prepared: PreparedSfRequest,
  options: { liveCallsEnabled: boolean; fetchImpl?: typeof fetch },
): Promise<{ status: number; body: string }> {
  if (!options.liveCallsEnabled) throw new SfLiveCallsDisabledError();
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(prepared.url, {
    method: prepared.method,
    headers: prepared.headers,
    body: prepared.body,
  });
  return { status: response.status, body: await response.text() };
}
