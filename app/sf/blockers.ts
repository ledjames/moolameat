/** Open items still waiting on SF Express. The app does not guess answers. */
export const SF_BLOCKERS = [
  {
    id: "production-url",
    title: "Full production path and port",
    detail:
      "SF confirmed the production gateway host https://portal-gateway.sf-express.com only. The path and port are unconfirmed. URLs made by removing .sit or port 55443 from the SIT URL are refused.",
  },
  {
    id: "credential-mapping",
    title: "Credential field mapping",
    detail:
      "SF issued AccessCode, PassCode, and MD5 Checkword. The spec has Access Code, Check Word, and an MD5 special string, and it has no PassCode field. The default map (AccessCode → Access Code, PassCode → Check Word, MD5 Checkword → MD5 special string) is likely and still unconfirmed.",
  },
  {
    id: "credential-final",
    title: "Whether the issued credentials are the final set",
    detail:
      "It is unconfirmed whether the three issued fields are the final SIT set, the final production set, or both. Values stay in environment variables and are never shown in the admin.",
  },
  {
    id: "transport",
    title: "Content-Type and sysSource / serviceCode placement",
    detail:
      "The spec requires a form body (logistics_interface and data_digest) and says sysSource and serviceCode are request headers. It does not name a Content-Type. Defaults follow that documented shape and can be changed.",
  },
  {
    id: "format",
    title: "XML vs JSON",
    detail:
      "The spec's general rule is UTF-8 XML, and section 3.16 also has a JSON sample. The payload format defaults to XML and can be switched to JSON. SF has not said which one Moola should send.",
  },
  {
    id: "push-url",
    title: "PUSH URL not yet issued",
    detail:
      "Daniel recommended 3.15 push for route and status, with 3.16 query as backup. The 3.15 receiver in this app is a stub and returns 404. No callback URL has been given to SF Express.",
  },
] as const;
