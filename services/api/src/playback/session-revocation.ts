import { and, eq, inArray, isNull, type SQL } from 'drizzle-orm';
import type { Executor } from '../database/database.types';
import { content, playbackSessions } from '../database/schema';

export interface RevocationScope {
  userId?: string;
  deviceId?: string;
  sessionId?: string;
  contentId?: string;
  /** Only sessions for premium content (used when a user loses their entitlement). */
  premiumOnly?: boolean;
}

/**
 * Revokes open playback sessions (not ended, not revoked) in the given scope. The next heartbeat on a
 * revoked session gets `403 PLAYBACK_SESSION_ENDED`. Returns the number of sessions revoked.
 */
export async function revokePlaybackSessions(
  db: Executor,
  scope: RevocationScope,
  reason: string,
  now: Date,
): Promise<number> {
  const conditions: SQL[] = [isNull(playbackSessions.endedAt), isNull(playbackSessions.revokedAt)];
  if (scope.userId) conditions.push(eq(playbackSessions.userId, scope.userId));
  if (scope.deviceId) conditions.push(eq(playbackSessions.deviceId, scope.deviceId));
  if (scope.sessionId) conditions.push(eq(playbackSessions.id, scope.sessionId));
  if (scope.contentId) conditions.push(eq(playbackSessions.contentId, scope.contentId));
  if (scope.premiumOnly) {
    conditions.push(
      inArray(
        playbackSessions.contentId,
        db.select({ id: content.id }).from(content).where(eq(content.accessTier, 'premium')),
      ),
    );
  }
  if (conditions.length === 2) {
    throw new Error('Refusing to revoke playback sessions without a scope');
  }
  const rows = await db
    .update(playbackSessions)
    .set({ revokedAt: now, revokeReason: reason })
    .where(and(...conditions))
    .returning({ id: playbackSessions.id });
  return rows.length;
}
