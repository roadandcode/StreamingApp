import { randomUUID } from 'node:crypto';
import {
  decideRefresh,
  generateRefreshToken,
  hashRefreshToken,
  issueRefreshToken,
  type NewRefreshSession,
  type RefreshSessionRecord,
  type RefreshSessionStore,
  rotateRefreshToken,
} from './refresh-tokens';

class InMemorySessionStore implements RefreshSessionStore {
  readonly rows = new Map<string, RefreshSessionRecord & { tokenHash: string }>();

  findByTokenHash(tokenHash: string): Promise<RefreshSessionRecord | null> {
    return Promise.resolve([...this.rows.values()].find((row) => row.tokenHash === tokenHash) ?? null);
  }

  markRotated(id: string, now: Date): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row || row.rotatedAt || row.revokedAt) return Promise.resolve(false);
    row.rotatedAt = now;
    return Promise.resolve(true);
  }

  create(session: NewRefreshSession): Promise<RefreshSessionRecord> {
    const row = {
      id: randomUUID(),
      userId: session.userId,
      familyId: session.familyId,
      tokenHash: session.tokenHash,
      expiresAt: session.expiresAt,
      revokedAt: null,
      rotatedAt: null,
    };
    this.rows.set(row.id, row);
    return Promise.resolve({ ...row });
  }

  revokeFamily(familyId: string, now: Date): Promise<void> {
    for (const row of this.rows.values()) {
      if (row.familyId === familyId && !row.revokedAt) row.revokedAt = now;
    }
    return Promise.resolve();
  }
}

const HOUR = 3_600_000;
const t0 = new Date('2026-11-01T00:00:00.000Z');
const at = (ms: number) => new Date(t0.getTime() + ms);

describe('refresh token primitives', () => {
  it('generates 32 random bytes as base64url and hashes with SHA-256', () => {
    const token = generateRefreshToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(generateRefreshToken()).not.toBe(token);
    expect(hashRefreshToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRefreshToken(token)).toBe(hashRefreshToken(token));
  });

  it('decides rotate / reuse / invalid from the stored record', () => {
    const base: RefreshSessionRecord = {
      id: 'a',
      userId: 'u',
      familyId: 'f',
      expiresAt: at(HOUR),
      revokedAt: null,
      rotatedAt: null,
    };
    expect(decideRefresh(null, t0)).toBe('invalid');
    expect(decideRefresh(base, t0)).toBe('rotate');
    expect(decideRefresh({ ...base, rotatedAt: t0 }, t0)).toBe('reuse_detected');
    expect(decideRefresh({ ...base, revokedAt: t0 }, t0)).toBe('invalid');
    expect(decideRefresh({ ...base, revokedAt: t0, rotatedAt: t0 }, t0)).toBe('invalid');
    expect(decideRefresh(base, at(HOUR))).toBe('invalid');
  });
});

describe('rotateRefreshToken', () => {
  const ttlMs = 30 * 24 * HOUR;

  it('rotates: the new token works, in the same family, and the old one is marked rotated', async () => {
    const store = new InMemorySessionStore();
    const first = await issueRefreshToken(store, 'user-1', { now: t0, ttlMs });

    const second = await rotateRefreshToken(store, first.refreshToken, { now: at(1000), ttlMs });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(second.session.familyId).toBe(first.session.familyId);
    expect(second.session.userId).toBe('user-1');
    expect(store.rows.get(first.session.id)?.rotatedAt).toEqual(at(1000));

    const third = await rotateRefreshToken(store, second.refreshToken, { now: at(2000), ttlMs });
    expect(third.ok).toBe(true);
  });

  it('detects reuse of a rotated token and revokes the whole family', async () => {
    const store = new InMemorySessionStore();
    const first = await issueRefreshToken(store, 'user-1', { now: t0, ttlMs });
    const second = await rotateRefreshToken(store, first.refreshToken, { now: at(1000), ttlMs });
    if (!second.ok) throw new Error('expected rotation');

    const replay = await rotateRefreshToken(store, first.refreshToken, { now: at(2000), ttlMs });
    expect(replay).toEqual({ ok: false, reason: 'reuse_detected', familyId: first.session.familyId });
    for (const row of store.rows.values()) {
      expect(row.revokedAt).toEqual(at(2000));
    }

    // The legitimately rotated token is now dead too.
    const afterRevoke = await rotateRefreshToken(store, second.refreshToken, { now: at(3000), ttlMs });
    expect(afterRevoke).toEqual({ ok: false, reason: 'invalid' });
  });

  it('does not touch other families when reuse is detected', async () => {
    const store = new InMemorySessionStore();
    const phone = await issueRefreshToken(store, 'user-1', { now: t0, ttlMs });
    const tablet = await issueRefreshToken(store, 'user-1', { now: t0, ttlMs });
    await rotateRefreshToken(store, phone.refreshToken, { now: at(1), ttlMs });
    await rotateRefreshToken(store, phone.refreshToken, { now: at(2), ttlMs });

    const tabletRotation = await rotateRefreshToken(store, tablet.refreshToken, { now: at(3), ttlMs });
    expect(tabletRotation.ok).toBe(true);
  });

  it('rejects unknown, expired and revoked tokens without revoking anything', async () => {
    const store = new InMemorySessionStore();
    const issued = await issueRefreshToken(store, 'user-1', { now: t0, ttlMs: HOUR });

    await expect(rotateRefreshToken(store, generateRefreshToken(), { now: t0, ttlMs })).resolves.toEqual({
      ok: false,
      reason: 'invalid',
    });
    await expect(rotateRefreshToken(store, issued.refreshToken, { now: at(HOUR), ttlMs })).resolves.toEqual({
      ok: false,
      reason: 'invalid',
    });
    expect(store.rows.get(issued.session.id)?.revokedAt).toBeNull();

    await store.revokeFamily(issued.session.familyId, t0);
    await expect(rotateRefreshToken(store, issued.refreshToken, { now: t0, ttlMs })).resolves.toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('treats losing a concurrent rotation race as reuse', async () => {
    const store = new InMemorySessionStore();
    const issued = await issueRefreshToken(store, 'user-1', { now: t0, ttlMs });
    const realFind = store.findByTokenHash.bind(store);
    // Simulate another request rotating the token between our read and our update.
    jest.spyOn(store, 'findByTokenHash').mockImplementationOnce(async (hash) => {
      const record = await realFind(hash);
      await store.markRotated(issued.session.id, t0);
      return record ? { ...record, rotatedAt: null } : null;
    });
    const result = await rotateRefreshToken(store, issued.refreshToken, { now: at(5), ttlMs });
    expect(result).toMatchObject({ ok: false, reason: 'reuse_detected' });
    expect(store.rows.get(issued.session.id)?.revokedAt).toEqual(at(5));
  });
});
