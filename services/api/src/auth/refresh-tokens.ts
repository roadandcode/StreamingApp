import { createHash, randomBytes, randomUUID } from 'node:crypto';

/**
 * Refresh-token rotation with reuse detection.
 *
 * Every refresh token is 32 random bytes (base64url) and only its SHA-256 hash is stored. Using a
 * token rotates it: the old record is stamped `rotatedAt` and a new record joins the same family.
 * Presenting a token that was already rotated means it leaked (or was replayed), so the whole family
 * is revoked and the caller must log in again.
 */
export interface RefreshSessionRecord {
  id: string;
  userId: string;
  familyId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  rotatedAt: Date | null;
}

export interface NewRefreshSession {
  userId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
}

/** Persistence used by the rotation logic; the database implementation runs inside one transaction. */
export interface RefreshSessionStore {
  findByTokenHash(tokenHash: string): Promise<RefreshSessionRecord | null>;
  /** Stamps `rotatedAt` only if the record is still current; returns false if it was not. */
  markRotated(id: string, now: Date): Promise<boolean>;
  create(session: NewRefreshSession): Promise<RefreshSessionRecord>;
  revokeFamily(familyId: string, now: Date): Promise<void>;
}

export const REFRESH_TOKEN_BYTES = 32;

export function generateRefreshToken(): string {
  return randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export type RefreshDecision = 'rotate' | 'reuse_detected' | 'invalid';

/** Pure decision for a presented token's stored record. */
export function decideRefresh(record: RefreshSessionRecord | null, now: Date): RefreshDecision {
  if (!record) return 'invalid';
  if (record.revokedAt) return 'invalid';
  if (record.rotatedAt) return 'reuse_detected';
  if (record.expiresAt.getTime() <= now.getTime()) return 'invalid';
  return 'rotate';
}

export interface IssuedRefreshToken {
  refreshToken: string;
  session: RefreshSessionRecord;
}

/** Starts a new session family (login / registration). */
export async function issueRefreshToken(
  store: RefreshSessionStore,
  userId: string,
  options: { now: Date; ttlMs: number },
): Promise<IssuedRefreshToken> {
  const refreshToken = generateRefreshToken();
  const session = await store.create({
    userId,
    familyId: randomUUID(),
    tokenHash: hashRefreshToken(refreshToken),
    expiresAt: new Date(options.now.getTime() + options.ttlMs),
    createdAt: options.now,
  });
  return { refreshToken, session };
}

export type RotationResult =
  | ({ ok: true } & IssuedRefreshToken)
  | { ok: false; reason: 'invalid' | 'reuse_detected'; familyId?: string };

export async function rotateRefreshToken(
  store: RefreshSessionStore,
  presentedToken: string,
  options: { now: Date; ttlMs: number },
): Promise<RotationResult> {
  const { now, ttlMs } = options;
  const record = await store.findByTokenHash(hashRefreshToken(presentedToken));
  const decision = decideRefresh(record, now);
  if (decision === 'invalid' || !record) {
    return { ok: false, reason: 'invalid' };
  }
  if (decision === 'reuse_detected') {
    await store.revokeFamily(record.familyId, now);
    return { ok: false, reason: 'reuse_detected', familyId: record.familyId };
  }
  const claimed = await store.markRotated(record.id, now);
  if (!claimed) {
    // Lost a race with another use of the same token: treat it as reuse.
    await store.revokeFamily(record.familyId, now);
    return { ok: false, reason: 'reuse_detected', familyId: record.familyId };
  }
  const refreshToken = generateRefreshToken();
  const session = await store.create({
    userId: record.userId,
    familyId: record.familyId,
    tokenHash: hashRefreshToken(refreshToken),
    expiresAt: new Date(now.getTime() + ttlMs),
    createdAt: now,
  });
  return { ok: true, refreshToken, session };
}
