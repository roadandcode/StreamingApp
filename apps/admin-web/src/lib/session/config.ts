import type { SessionOptions } from "iron-session";
import { getServerEnv } from "../env";
import type { Role, Tokens, User } from "../api/types";

/**
 * Everything the dashboard keeps about a signed-in admin. It lives only inside an encrypted,
 * httpOnly cookie; nothing here is ever sent to client components.
 */
export interface AdminSessionData {
  user: {
    id: string;
    email: string;
    displayName: string | null;
    role: Role;
  };
  accessToken: string;
  /** Epoch milliseconds. */
  accessTokenExpiresAt: number;
  refreshToken: string;
  /** Epoch milliseconds. */
  refreshTokenExpiresAt: number;
  /** Epoch milliseconds when the current tokens were issued to us (login or refresh). */
  tokensReceivedAt?: number;
  /** Epoch milliseconds of the last recovery from a rejected access token, to stop redirect loops. */
  recoveredAt?: number;
}

/** Sliding lifetime of the cookie itself; every token refresh re-saves and extends it. */
export const SESSION_TTL_SECONDS = 12 * 60 * 60;

/** Refresh the access token when it has less than this left (or a quarter of its lifetime, if shorter). */
export const ACCESS_TOKEN_REFRESH_MARGIN_MS = 60_000;

export function refreshMarginMs(lifetimeMs: number): number {
  if (!Number.isFinite(lifetimeMs) || lifetimeMs <= 0) {
    return ACCESS_TOKEN_REFRESH_MARGIN_MS;
  }
  return Math.min(ACCESS_TOKEN_REFRESH_MARGIN_MS, lifetimeMs / 4);
}

export function getSessionOptions(): SessionOptions {
  const env = getServerEnv();
  return {
    password: env.sessionCookieSecret,
    // The __Host- prefix pins the cookie to this exact host over HTTPS (no Domain, Path=/).
    cookieName: env.isProduction ? "__Host-streamingapp_admin" : "streamingapp_admin",
    ttl: SESSION_TTL_SECONDS,
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      secure: env.isProduction,
      path: "/",
    },
    onUnsealError: (reason) => {
      if (reason !== "expired") {
        console.warn(`[session] rejected an unreadable session cookie (${reason}).`);
      }
    },
  };
}

/** Narrows a session read from the cookie to a complete, unexpired admin session. */
export function isActiveAdminSession(
  session: Partial<AdminSessionData>,
  now: number = Date.now(),
): session is AdminSessionData {
  return (
    typeof session.accessToken === "string" &&
    typeof session.refreshToken === "string" &&
    typeof session.accessTokenExpiresAt === "number" &&
    typeof session.refreshTokenExpiresAt === "number" &&
    session.refreshTokenExpiresAt > now &&
    typeof session.user === "object" &&
    session.user !== null &&
    session.user.role === "admin"
  );
}

export function accessTokenNeedsRefresh(session: AdminSessionData, now: number = Date.now()): boolean {
  const lifetime =
    session.tokensReceivedAt === undefined ? Number.NaN : session.accessTokenExpiresAt - session.tokensReceivedAt;
  return session.accessTokenExpiresAt - now < refreshMarginMs(lifetime);
}

function toEpochMs(iso: string, fallback: number): number {
  const value = Date.parse(iso);
  return Number.isNaN(value) ? fallback : value;
}

/** Copies a token pair from the API into the session (the caller saves it). */
export function applyTokens(session: Partial<AdminSessionData>, tokens: Tokens, now: number = Date.now()): void {
  session.accessToken = tokens.accessToken;
  session.accessTokenExpiresAt = toEpochMs(tokens.accessTokenExpiresAt, now);
  session.refreshToken = tokens.refreshToken;
  session.refreshTokenExpiresAt = toEpochMs(tokens.refreshTokenExpiresAt, now);
  session.tokensReceivedAt = now;
}

export function sessionUserFrom(user: User): AdminSessionData["user"] {
  return { id: user.id, email: user.email, displayName: user.displayName, role: user.role };
}
