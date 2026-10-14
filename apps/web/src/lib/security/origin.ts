/**
 * Cross-site request forgery guard for mutating route handlers. Server actions get the same check
 * from Next.js itself.
 *
 * A request is accepted only when its `Origin` header is one of the allowed origins (this site's
 * public origin and the origin the request was addressed to). Requests without an `Origin` header
 * are rejected: every browser we support sends it on POST, including `navigator.sendBeacon`.
 */
export function isAllowedOrigin(
  originHeader: string | null,
  secFetchSite: string | null,
  allowedOrigins: readonly string[],
): boolean {
  if (secFetchSite && secFetchSite !== "same-origin") return false;
  if (!originHeader || originHeader === "null") return false;
  let origin: string;
  try {
    origin = new URL(originHeader).origin;
  } catch {
    return false;
  }
  return allowedOrigins.some((allowed) => {
    try {
      return new URL(allowed).origin === origin;
    } catch {
      return false;
    }
  });
}
