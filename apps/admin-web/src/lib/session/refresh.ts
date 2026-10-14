import { refreshTokens } from "../api/auth-api";
import { isApiError } from "../api/errors";
import type { Tokens } from "../api/types";
import { refreshMarginMs } from "./config";

/**
 * The API rotates refresh tokens and treats a second use of an old one as theft: it revokes the
 * whole session. A browser fires several requests at once (navigation plus prefetches), and the
 * responses can come back in any order, so a request may still carry a refresh token that a
 * sibling request has just rotated. This module makes sure such a token is never presented again:
 *
 * - every refresh token this process has seen maps to its login session ("family"), which knows
 *   the newest refresh token and the newest tokens;
 * - a request carrying an already-rotated token gets the family's newest tokens;
 * - concurrent rotations of one family share a single API call.
 *
 * The map lives on `globalThis` so the proxy and the app server share it when they run in one
 * process. With several server instances, keep each browser on one instance (sticky sessions).
 */
const FAMILY_IDLE_MS = 5 * 60_000;

interface Family {
  /** Newest refresh token of this session known to this process. */
  current: string;
  /** Tokens from the newest rotation done here, and when they were received. */
  latest?: Tokens;
  latestReceivedAt?: number;
  inflight?: Promise<Tokens>;
  touchedAt: number;
}

const STORE_KEY = Symbol.for("streamingapp.admin.refreshFamilies");

function store(): Map<string, Family> {
  const holder = globalThis as typeof globalThis & { [STORE_KEY]?: Map<string, Family> };
  holder[STORE_KEY] ??= new Map();
  return holder[STORE_KEY];
}

function prune(families: Map<string, Family>, now: number): void {
  for (const [token, family] of families) {
    if (!family.inflight && now - family.touchedAt > FAMILY_IDLE_MS) {
      families.delete(token);
    }
  }
}

function expiresSoon(tokens: Tokens, receivedAt: number, now: number): boolean {
  const expiresAt = Date.parse(tokens.accessTokenExpiresAt);
  if (Number.isNaN(expiresAt)) return true;
  return expiresAt - now < refreshMarginMs(expiresAt - receivedAt);
}

function rotate(families: Map<string, Family>, family: Family): Promise<Tokens> {
  if (family.inflight) {
    return family.inflight;
  }
  const promise = refreshTokens(family.current)
    .then((tokens) => {
      const now = Date.now();
      family.current = tokens.refreshToken;
      family.latest = tokens;
      family.latestReceivedAt = now;
      family.touchedAt = now;
      families.set(tokens.refreshToken, family);
      return tokens;
    })
    .finally(() => {
      family.inflight = undefined;
    });
  family.inflight = promise;
  return promise;
}

/**
 * Returns fresh tokens for a session whose cookie holds `refreshToken`. Rotates the session's
 * newest refresh token at most once per need; `force` rotates even when the newest known tokens
 * still look valid (used after the API rejected an access token).
 */
export function obtainFreshTokens(refreshToken: string, options: { force?: boolean } = {}): Promise<Tokens> {
  const families = store();
  const now = Date.now();
  prune(families, now);

  let family = families.get(refreshToken);
  if (!family) {
    family = { current: refreshToken, touchedAt: now };
    families.set(refreshToken, family);
  }
  family.touchedAt = now;

  if (family.inflight) {
    return family.inflight;
  }
  const alreadyRotated = family.current !== refreshToken;
  if (
    alreadyRotated &&
    !options.force &&
    family.latest &&
    family.latestReceivedAt !== undefined &&
    !expiresSoon(family.latest, family.latestReceivedAt, now)
  ) {
    return Promise.resolve(family.latest);
  }
  return rotate(families, family);
}

/** True when a refresh failure means the session can never be refreshed again. */
export function isTerminalRefreshFailure(error: unknown): boolean {
  if (!isApiError(error)) {
    return false;
  }
  return error.statusCode >= 400 && error.statusCode < 500 && error.statusCode !== 429;
}
