import { NextResponse } from "next/server";
import { revokeRefreshToken } from "@/lib/api/auth-api";
import { forbiddenOriginResponse, isSameOriginRequest } from "@/lib/request-origin";
import { getSession, loginPath } from "@/lib/session/server";

/** POST /auth/logout — revokes the API session and clears the cookie. */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return forbiddenOriginResponse();
  }

  const session = await getSession();
  if (session.refreshToken) {
    try {
      await revokeRefreshToken(session.refreshToken);
    } catch {
      // Already revoked, or the API is unreachable: the local session is cleared either way.
    }
  }
  session.destroy();

  // 303 turns the form POST into a GET of the login page.
  return NextResponse.redirect(new URL(loginPath("signed-out"), request.url), 303);
}
