import { NextResponse } from "next/server";
import { applyTokens, isActiveAdminSession } from "@/lib/session/config";
import { obtainFreshTokens } from "@/lib/session/refresh";
import { isCrossSiteNavigation } from "@/lib/request-origin";
import { getSession, loginPath, safeNextPath } from "@/lib/session/server";

/** A recovery this recent that ends up here again means the API keeps rejecting fresh tokens. */
const LOOP_GUARD_MS = 15_000;

/**
 * GET /auth/refresh?next=/path — server components send the browser here when the API rejects
 * the access token (they cannot write cookies while rendering). Gets new tokens once and sends
 * the browser back; if that is impossible, signs out.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = safeNextPath(url.searchParams.get("next")) ?? "/content";
  const to = (path: string) => NextResponse.redirect(new URL(path, request.url), 303);

  if (isCrossSiteNavigation(request)) {
    return to("/content");
  }

  const session = await getSession();
  if (!isActiveAdminSession(session)) {
    session.destroy();
    return to(loginPath(undefined, next));
  }

  if (session.recoveredAt !== undefined && Date.now() - session.recoveredAt < LOOP_GUARD_MS) {
    session.destroy();
    return to(loginPath("expired", next));
  }

  try {
    const tokens = await obtainFreshTokens(session.refreshToken, { force: true });
    applyTokens(session, tokens);
    session.recoveredAt = Date.now();
    await session.save();
    return to(next);
  } catch {
    // Whether the token was rejected or the refresh call failed, the page cannot load with the
    // current token; sending the browser back would only loop.
    session.destroy();
    return to(loginPath("expired", next));
  }
}
