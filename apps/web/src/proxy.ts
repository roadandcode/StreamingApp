import { NextResponse, type NextRequest } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { getConfig } from "@/lib/config";
import {
  SESSION_COOKIE,
  accessTokenNeedsRefresh,
  sealSession,
  sessionCookieOptions,
  unsealSession,
} from "@/lib/session/codec";
import { refreshSessionTokens } from "@/lib/session/tokens";
import { buildCsp } from "@/lib/security/csp";

/**
 * Runs before every page render and server action:
 *
 * 1. Generates the per-request CSP nonce.
 * 2. Keeps the API access token fresh. Server components cannot set cookies, so tokens that are
 *    about to expire are refreshed here and the rotated tokens are written both to the response
 *    cookie and to the request the page renders with.
 */
export async function proxy(request: NextRequest) {
  const config = getConfig();

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp({
    nonce,
    mediaOrigins: config.mediaOrigins,
    isDevelopment: process.env.NODE_ENV === "development",
    upgradeInsecureRequests: config.isProduction && config.siteUrl.startsWith("https://"),
  });

  let sessionCookie: { value: string; maxAge: number } | null = null;
  let clearSessionCookie = false;

  const session = await unsealSession(request.cookies.get(SESSION_COOKIE)?.value, config.sessionCookieSecret);
  if (session && accessTokenNeedsRefresh(session)) {
    try {
      const tokens = await refreshSessionTokens(config.apiBaseUrl, session.tokens.refreshToken);
      const next = { ...session, tokens };
      const sealed = await sealSession(next, config.sessionCookieSecret);
      sessionCookie = { value: sealed, maxAge: sessionCookieOptions(next, config.isProduction).maxAge };
      request.cookies.set(SESSION_COOKIE, sealed);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        // Refresh token expired, revoked or reused: the viewer is signed out.
        clearSessionCookie = true;
        request.cookies.delete(SESSION_COOKIE);
      }
      // Network errors: leave the cookie alone and let the page render signed-out-safe.
    }
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", csp);

  if (sessionCookie) {
    response.cookies.set(SESSION_COOKIE, sessionCookie.value, {
      httpOnly: true,
      sameSite: "lax",
      secure: config.isProduction,
      path: "/",
      maxAge: sessionCookie.maxAge,
    });
  } else if (clearSessionCookie) {
    response.cookies.delete(SESSION_COOKIE);
  }
  return response;
}

export const config = {
  matcher: [
    {
      // Pages and server actions. API route handlers refresh tokens themselves.
      source: "/((?!api/|_next/static|_next/image|favicon.ico|icon.svg|robots.txt|sitemap.xml|media/).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
