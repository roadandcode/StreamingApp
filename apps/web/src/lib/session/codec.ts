import { sealData, unsealData } from "iron-session";
import type { Tokens, User } from "@/lib/api/types";

/** Encrypted, httpOnly cookie holding the API tokens. Browser JavaScript can never read it. */
export const SESSION_COOKIE = "sa_session";
/** Long-lived, httpOnly cookie with this browser's device `installationId`. */
export const INSTALLATION_COOKIE = "sa_installation";

/** About 400 days, the longest lifetime current browsers accept for a cookie. */
export const INSTALLATION_COOKIE_MAX_AGE = 400 * 24 * 60 * 60;

/** Refresh the access token when it expires within this many seconds. */
export const ACCESS_TOKEN_REFRESH_MARGIN_SECONDS = 60;

export interface SessionUser {
  id: string;
  email: string;
  displayName: string | null;
}

export interface SessionData {
  v: 1;
  user: SessionUser;
  tokens: Tokens;
  /** Server-side id of this browser's registered device, once registration succeeded. */
  deviceId: string | null;
}

export function sessionFromAuth(user: User, tokens: Tokens, deviceId: string | null = null): SessionData {
  return {
    v: 1,
    user: { id: user.id, email: user.email, displayName: user.displayName },
    tokens,
    deviceId,
  };
}

/** Seconds until the refresh token expires (the session cannot outlive it). */
export function sessionLifetimeSeconds(data: SessionData, now = Date.now()): number {
  const until = Date.parse(data.tokens.refreshTokenExpiresAt);
  if (Number.isNaN(until)) return 60 * 60;
  return Math.max(60, Math.floor((until - now) / 1000));
}

export function accessTokenNeedsRefresh(data: SessionData, now = Date.now()): boolean {
  const expiresAt = Date.parse(data.tokens.accessTokenExpiresAt);
  if (Number.isNaN(expiresAt)) return true;
  return expiresAt - now <= ACCESS_TOKEN_REFRESH_MARGIN_SECONDS * 1000;
}

export async function sealSession(data: SessionData, secret: string): Promise<string> {
  return sealData(data, { password: secret, ttl: sessionLifetimeSeconds(data) });
}

function isSessionData(value: unknown): value is SessionData {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Partial<SessionData>;
  return (
    v.v === 1 &&
    typeof v.user?.id === "string" &&
    typeof v.user.email === "string" &&
    typeof v.tokens?.accessToken === "string" &&
    typeof v.tokens.refreshToken === "string" &&
    typeof v.tokens.accessTokenExpiresAt === "string" &&
    typeof v.tokens.refreshTokenExpiresAt === "string"
  );
}

/** Returns `null` for a missing, tampered, expired or outdated cookie. */
export async function unsealSession(value: string | undefined, secret: string): Promise<SessionData | null> {
  if (!value) return null;
  try {
    // ttl 0 here: the seal carries its own expiry, set when it was sealed.
    const data = await unsealData<unknown>(value, { password: secret, ttl: 0 });
    return isSessionData(data) ? { ...data, deviceId: data.deviceId ?? null } : null;
  } catch {
    return null;
  }
}

export interface CookieOptions {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: "/";
  maxAge: number;
}

export function sessionCookieOptions(data: SessionData, secure: boolean): CookieOptions {
  return { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: sessionLifetimeSeconds(data) };
}

export function installationCookieOptions(secure: boolean): CookieOptions {
  return { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: INSTALLATION_COOKIE_MAX_AGE };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}
