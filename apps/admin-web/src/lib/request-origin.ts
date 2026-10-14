/**
 * CSRF guards for route handlers. Server actions get the same Origin check from Next itself;
 * route handlers that change state must call one of these first.
 */

function expectedHost(request: Request): string | null {
  return request.headers.get("x-forwarded-host") ?? request.headers.get("host");
}

/** For POST/PATCH/DELETE handlers: the browser-supplied Origin must be this app. */
export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = expectedHost(request);
  if (!origin || !host) {
    return false;
  }
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * For GET handlers with side effects (browsers omit Origin on same-origin navigations): reject
 * requests the browser marks as coming from another site.
 */
export function isCrossSiteNavigation(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  return site === "cross-site" || site === "same-site";
}

export function forbiddenOriginResponse(): Response {
  return Response.json(
    { statusCode: 403, code: "FORBIDDEN", message: "Cross-origin request rejected." },
    { status: 403 },
  );
}
