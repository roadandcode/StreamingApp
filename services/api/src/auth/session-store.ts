import { and, eq, isNull } from 'drizzle-orm';
import type { Executor } from '../database/database.types';
import { userSessions } from '../database/schema';
import type { NewRefreshSession, RefreshSessionRecord, RefreshSessionStore } from './refresh-tokens';

const recordColumns = {
  id: userSessions.id,
  userId: userSessions.userId,
  familyId: userSessions.familyId,
  expiresAt: userSessions.expiresAt,
  revokedAt: userSessions.revokedAt,
  rotatedAt: userSessions.rotatedAt,
};

/** `user_sessions` access for the rotation logic; pass a transaction for atomic rotation. */
export class DrizzleRefreshSessionStore implements RefreshSessionStore {
  constructor(private readonly db: Executor) {}

  async findByTokenHash(tokenHash: string): Promise<RefreshSessionRecord | null> {
    const rows = await this.db
      .select(recordColumns)
      .from(userSessions)
      .where(eq(userSessions.refreshTokenHash, tokenHash))
      .for('update')
      .limit(1);
    return rows[0] ?? null;
  }

  async markRotated(id: string, now: Date): Promise<boolean> {
    const rows = await this.db
      .update(userSessions)
      .set({ rotatedAt: now })
      .where(and(eq(userSessions.id, id), isNull(userSessions.rotatedAt), isNull(userSessions.revokedAt)))
      .returning({ id: userSessions.id });
    return rows.length === 1;
  }

  async create(session: NewRefreshSession): Promise<RefreshSessionRecord> {
    const [row] = await this.db
      .insert(userSessions)
      .values({
        userId: session.userId,
        familyId: session.familyId,
        refreshTokenHash: session.tokenHash,
        expiresAt: session.expiresAt,
        createdAt: session.createdAt,
      })
      .returning(recordColumns);
    if (!row) throw new Error('Failed to create session');
    return row;
  }

  async revokeFamily(familyId: string, now: Date): Promise<void> {
    await this.db
      .update(userSessions)
      .set({ revokedAt: now })
      .where(and(eq(userSessions.familyId, familyId), isNull(userSessions.revokedAt)));
  }
}

/** Revokes every login session of a user (logout everywhere, account deletion, admin action). */
export async function revokeAllUserSessions(db: Executor, userId: string, now: Date): Promise<number> {
  const rows = await db
    .update(userSessions)
    .set({ revokedAt: now })
    .where(and(eq(userSessions.userId, userId), isNull(userSessions.revokedAt)))
    .returning({ id: userSessions.id });
  return rows.length;
}
