import type { LocalAuth } from "./localAuth";

/** Browser cookies require a trusted origin for cross-origin requests. */
export function localRequestOriginFailure(request: Request, auth?: LocalAuth): Response | null {
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  const trusted = origin !== null
    ? (auth?.isTrustedOrigin?.(origin) ?? origin === new URL(request.url).origin)
    // Non-browser clients may omit browser metadata. Browsers must not use a
    // stripped Origin to turn a foreign request into a trusted one.
    : site === null || site === "same-origin";
  return trusted ? null : Response.json({
    error: { code: "untrusted_origin", message: "Request origin is not trusted." },
  }, { status: 403 });
}
