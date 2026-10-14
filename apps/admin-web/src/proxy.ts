import { getIronSession, type CookieJar } from "iron-session";
import { NextResponse, type NextRequest } from "next/server";
import {
  accessTokenNeedsRefresh,
  applyTokens,
  getSessionOptions,
  isActiveAdminSession,
  type AdminSessionData,
} from "./lib/session/config";
import { isTerminalRefreshFailure, obtainFreshTokens } from "./lib/session/refresh";

/**
 * Runs before every page, server action and `/api/*` route (Next 16 renamed `middleware.ts` to
 * `proxy.ts`). It is the one place that can both read and write cookies before a page renders:
 *
 * - Redirects to `/login` when there is no admin session (GET/HEAD only; server actions and
 *   route handlers check the session themselves and answer in their own format).
 * - Refreshes the access token when it is about to expire and writes the rotated tokens both to
 *   the response cookie and to the cookie the page is about to read.
 * - Clears the session when the refresh token is rejected.
 */

interface PendingCookie {
  name: string;
  value: string;
  options: Parameters<CookieJar["write"]>[2];
}

const CURRENT_PATH_HEADER = "x-admin-path";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isLoginPage = pathname === "/login";
  const isApiRoute = pathname.startsWith("/api/");
  const isNavigation = request.method === "GET" || request.method === "HEAD";

  const pending: PendingCookie[] = [];
  const jar: CookieJar = {
    read: (name) => request.cookies.get(name)?.value,
    names: () => request.cookies.getAll().map((cookie) => cookie.name),
    write: (name, value, options) => {
      pending.push({ name, value, options });
      if (value === "" || options?.maxAge === 0) {
        request.cookies.delete(name);
      } else {
        request.cookies.set(name, value);
      }
    },
  };

  const session = await getIronSession<AdminSessionData>(jar, getSessionOptions());
  let signedIn = isActiveAdminSession(session);
  if (!signedIn && session.accessToken) {
    // Leftover or non-admin data: drop it.
    session.destroy();
  }

  if (signedIn && isActiveAdminSession(session) && accessTokenNeedsRefresh(session)) {
    try {
      const tokens = await obtainFreshTokens(session.refreshToken);
      applyTokens(session, tokens);
      await session.save();
    } catch (error) {
      if (isTerminalRefreshFailure(error)) {
        session.destroy();
        signedIn = false;
      }
      // Transient failures (API unreachable, 5xx, 429) keep the session; the page shows the error.
    }
  }

  const finish = (response: NextResponse): NextResponse => {
    for (const cookie of pending) {
      response.cookies.set(cookie.name, cookie.value, cookie.options);
    }
    return response;
  };

  if (!signedIn) {
    if (isLoginPage || !isNavigation) {
      return finish(NextResponse.next({ request: { headers: request.headers } }));
    }
    if (isApiRoute) {
      return finish(
        NextResponse.json(
          { statusCode: 401, code: "UNAUTHENTICATED", message: "Sign in to continue." },
          { status: 401 },
        ),
      );
    }
    const loginUrl = new URL("/login", request.url);
    const next = pathWithQuery(request);
    if (next !== "/" && next !== "/content") {
      loginUrl.searchParams.set("next", next);
    }
    return finish(NextResponse.redirect(loginUrl));
  }

  if (isLoginPage && isNavigation) {
    return finish(NextResponse.redirect(new URL("/content", request.url)));
  }

  const headers = new Headers(request.headers);
  headers.set(CURRENT_PATH_HEADER, pathWithQuery(request));
  return finish(NextResponse.next({ request: { headers } }));
}

function pathWithQuery(request: NextRequest): string {
  const params = new URLSearchParams(request.nextUrl.searchParams);
  params.delete("_rsc");
  const query = params.toString();
  return query ? `${request.nextUrl.pathname}?${query}` : request.nextUrl.pathname;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|auth/).*)"],
};
