import { parseStatusDocument } from "./parse-status";

export const PUSH_UNPUBLISHED_MESSAGE =
  "SF Express 3.15 outbound status receiver is not published. No callback URL has been given to SF Express. Nothing was stored and Shopify was not updated.";

export function unpublishedPushResponse(): Response {
  return new Response(PUSH_UNPUBLISHED_MESSAGE, {
    status: 404,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}

/**
 * Published flag only. Still a stub: it does not acknowledge the push with the
 * spec's success result, and it does not write Shopify fulfillments.
 * The raw body is never copied into the response.
 */
export function publishedStubResponse(raw: string, contentType: string | null): Response {
  let summary = "The body could not be parsed as an outbound status document.";
  try {
    const document = parseStatusDocument(raw, contentType);
    summary = `Parsed ${document.orders.length} outbound order(s). Head: ${document.head ?? "absent"}.`;
  } catch {
    summary = "The body could not be parsed as an outbound status document.";
  }
  return new Response(
    `3.15 receiver stub. ${summary} No success acknowledgement was returned to SF and no Shopify fulfillment was changed.`,
    {
      status: 501,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex",
      },
    },
  );
}
