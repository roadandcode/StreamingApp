import "server-only";

import type { IronSession } from "iron-session";
import { redirect } from "next/navigation";
import { accessTokenNeedsRefresh, applyTokens, isActiveAdminSession, type AdminSessionData } from "../session/config";
import { isTerminalRefreshFailure, obtainFreshTokens } from "../session/refresh";
import { currentPath, getSession, loginPath } from "../session/server";
import { ApiError, isApiError } from "./errors";
import { rawApiRequest, type RawRequestOptions } from "./http";

/**
 * - `"render"`: server components. Cookies are read-only while rendering, so a 401 sends the
 *   browser through `/auth/refresh`, which rotates the tokens and comes back (once).
 * - `"action"`: server actions and route handlers. Refreshes inline, persists the rotated
 *   tokens in the cookie and retries the call once.
 *
 * In both cases the proxy has usually refreshed an almost-expired access token before the
 * request reached the page, so these paths only run for unexpected 401s.
 */
export type ApiCallContext = "render" | "action";

export interface ApiFetchOptions extends Omit<RawRequestOptions, "accessToken"> {
  context?: ApiCallContext;
}

function sessionExpired(): ApiError {
  return new ApiError("UNAUTHENTICATED", 401, "Your session has expired. Please sign in again.");
}

async function refreshInPlace(
  session: IronSession<AdminSessionData> & AdminSessionData,
  options: { force: boolean },
): Promise<void> {
  try {
    const tokens = await obtainFreshTokens(session.refreshToken, options);
    applyTokens(session, tokens);
    await session.save();
  } catch (error) {
    if (isTerminalRefreshFailure(error)) {
      session.destroy();
      throw sessionExpired();
    }
    throw error;
  }
}

/**
 * Server-only API client: attaches the admin's bearer token, parses the contract error format
 * into `ApiError`, and refreshes the session once when the access token is expired or rejected.
 */
export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { context = "render", ...request } = options;
  const session = await getSession();

  if (!isActiveAdminSession(session)) {
    if (context === "render") {
      redirect(loginPath(undefined, await currentPath()));
    }
    throw sessionExpired();
  }

  if (context === "action" && accessTokenNeedsRefresh(session)) {
    try {
      await refreshInPlace(session, { force: false });
    } catch (error) {
      // A transient refresh failure is not fatal while the current token may still work.
      if (isApiError(error) && error.code === "UNAUTHENTICATED") {
        throw error;
      }
    }
  }

  try {
    return await rawApiRequest<T>(path, { ...request, accessToken: session.accessToken });
  } catch (error) {
    if (!isApiError(error) || error.code !== "UNAUTHENTICATED") {
      throw error;
    }
  }

  if (context === "render") {
    redirect(`/auth/refresh?next=${encodeURIComponent(await currentPath())}`);
  }

  await refreshInPlace(session, { force: true });
  try {
    return await rawApiRequest<T>(path, { ...request, accessToken: session.accessToken });
  } catch (error) {
    if (isApiError(error) && error.code === "UNAUTHENTICATED") {
      // A token that was issued a moment ago is still rejected: the session is unusable.
      session.destroy();
      throw sessionExpired();
    }
    throw error;
  }
}
