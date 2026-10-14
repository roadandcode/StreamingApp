import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq, gt, isNull } from 'drizzle-orm';
import { findReadyAsset, loadContentFacts } from '../catalog/content-visibility';
import { AppException } from '../common/errors';
import { AppConfig } from '../config/app-config';
import { type Database, DRIZZLE, type Executor } from '../database/database.types';
import { type AccountStatus, devices, playbackSessions, users } from '../database/schema';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { MEDIA_PROVIDER, type MediaProvider } from '../media/media-provider';
import type { CreatePlaybackSessionDto, HeartbeatDto, HeartbeatResponseDto, PlaybackAuthorizationDto } from './playback.dto';
import {
  evaluateHeartbeat,
  evaluateNewSession,
  type PlaybackDenialCode,
  type PlaybackDeviceFacts,
} from './playback-policy';

type HeartbeatOutcome = { ok: true; expiresAt: Date } | { ok: false; code: PlaybackDenialCode | 'PLAYBACK_SESSION_ENDED' };

@Injectable()
export class PlaybackService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(MEDIA_PROVIDER) private readonly media: MediaProvider,
    private readonly entitlements: EntitlementsService,
    private readonly config: AppConfig,
  ) {}

  private get ttlMs(): number {
    return this.config.get('PLAYBACK_AUTH_TTL_SECONDS') * 1000;
  }

  private staleBefore(now: Date): Date {
    return new Date(now.getTime() - this.config.playbackStaleAfterSeconds * 1000);
  }

  /** Active: not ended or revoked, unexpired, and a heartbeat within the stale window. */
  async countActiveSessions(executor: Executor, userId: string, now: Date): Promise<number> {
    const [row] = await executor
      .select({ active: count() })
      .from(playbackSessions)
      .where(
        and(
          eq(playbackSessions.userId, userId),
          isNull(playbackSessions.endedAt),
          isNull(playbackSessions.revokedAt),
          gt(playbackSessions.lastHeartbeatAt, this.staleBefore(now)),
          gt(playbackSessions.expiresAt, now),
        ),
      );
    return row?.active ?? 0;
  }

  private async deviceFacts(
    executor: Executor,
    userId: string,
    deviceId: string,
  ): Promise<{ facts: PlaybackDeviceFacts | null; platform: 'android' | 'ios' | 'web' | null }> {
    const [device] = await executor.select().from(devices).where(eq(devices.id, deviceId)).limit(1);
    if (!device) return { facts: null, platform: null };
    return {
      facts: { ownedByCaller: device.userId === userId, revoked: device.revokedAt !== null },
      platform: device.platform,
    };
  }

  private async accountStatus(executor: Executor, userId: string, lock: boolean): Promise<AccountStatus> {
    const query = executor.select({ status: users.accountStatus }).from(users).where(eq(users.id, userId));
    const [row] = lock ? await query.for('update') : await query;
    return row?.status ?? 'deleted';
  }

  async createSession(userId: string, dto: CreatePlaybackSessionDto, country: string): Promise<PlaybackAuthorizationDto> {
    const now = new Date();
    return this.db.transaction(async (tx) => {
      // Locking the user row serializes session creation per user, so the stream limit holds.
      const accountStatus = await this.accountStatus(tx, userId, true);
      const content = await loadContentFacts(tx, dto.contentId, country, now);
      const entitlement = await this.entitlements.getAccess(tx, userId, now);
      const device = await this.deviceFacts(tx, userId, dto.deviceId);
      const activeSessionCount = await this.countActiveSessions(tx, userId, now);

      const decision = evaluateNewSession({
        accountStatus,
        content: content && {
          published: content.published,
          availableInCountry: content.availableInCountry,
          hasReadyAsset: content.hasReadyAsset,
          accessTier: content.row.accessTier,
        },
        entitlement,
        device: device.facts,
        activeSessionCount,
        maxConcurrentStreams: this.config.get('MAX_CONCURRENT_STREAMS'),
      });
      if (!decision.ok) {
        throw new AppException(decision.code);
      }
      const asset = await findReadyAsset(tx, dto.contentId);
      if (!asset || !device.platform) {
        throw new AppException('CONTENT_NOT_PLAYABLE');
      }

      const [session] = await tx
        .insert(playbackSessions)
        .values({
          userId,
          deviceId: dto.deviceId,
          contentId: dto.contentId,
          startedAt: now,
          lastHeartbeatAt: now,
          expiresAt: new Date(now.getTime() + this.ttlMs),
        })
        .returning({ id: playbackSessions.id });
      if (!session) throw new Error('Playback session insert returned no row');

      const authorization = await this.media.createPlaybackAuthorization({
        providerAssetId: asset.providerAssetId,
        playbackSessionId: session.id,
        platform: device.platform,
        ttlSeconds: this.config.get('PLAYBACK_AUTH_TTL_SECONDS'),
      });
      await tx.update(playbackSessions).set({ expiresAt: authorization.expiresAt }).where(eq(playbackSessions.id, session.id));
      await tx.update(devices).set({ lastSeenAt: now }).where(eq(devices.id, dto.deviceId));

      return {
        playbackSessionId: session.id,
        contentId: dto.contentId,
        manifestUrl: authorization.manifestUrl,
        expiresAt: authorization.expiresAt.toISOString(),
        heartbeatIntervalSeconds: this.config.get('PLAYBACK_HEARTBEAT_INTERVAL_SECONDS'),
        drm: authorization.drm,
      };
    });
  }

  /**
   * Re-runs checks 1, 2, 4 and 5. On failure the session is revoked (committed) and the failing
   * code is returned; ended, revoked, expired or stale sessions get PLAYBACK_SESSION_ENDED.
   */
  async heartbeat(userId: string, sessionId: string, dto: HeartbeatDto, country: string): Promise<HeartbeatResponseDto> {
    const now = new Date();
    const outcome = await this.db.transaction(async (tx): Promise<HeartbeatOutcome> => {
      const [session] = await tx
        .select()
        .from(playbackSessions)
        .where(and(eq(playbackSessions.id, sessionId), eq(playbackSessions.userId, userId)))
        .for('update')
        .limit(1);
      if (!session) {
        throw new AppException('NOT_FOUND');
      }
      if (session.endedAt || session.revokedAt) {
        return { ok: false, code: 'PLAYBACK_SESSION_ENDED' };
      }
      if (session.expiresAt.getTime() <= now.getTime() || session.lastHeartbeatAt.getTime() <= this.staleBefore(now).getTime()) {
        await tx.update(playbackSessions).set({ endedAt: now }).where(eq(playbackSessions.id, session.id));
        return { ok: false, code: 'PLAYBACK_SESSION_ENDED' };
      }

      const content = await loadContentFacts(tx, session.contentId, country, now);
      const decision = evaluateHeartbeat({
        accountStatus: await this.accountStatus(tx, userId, false),
        content: content && {
          published: content.published,
          availableInCountry: content.availableInCountry,
          hasReadyAsset: content.hasReadyAsset,
          accessTier: content.row.accessTier,
        },
        entitlement: await this.entitlements.getAccess(tx, userId, now),
        device: (await this.deviceFacts(tx, userId, session.deviceId)).facts,
      });
      if (!decision.ok) {
        await tx
          .update(playbackSessions)
          .set({ revokedAt: now, revokeReason: decision.code })
          .where(eq(playbackSessions.id, session.id));
        return { ok: false, code: decision.code };
      }

      const expiresAt = new Date(now.getTime() + this.ttlMs);
      await tx
        .update(playbackSessions)
        .set({
          lastHeartbeatAt: now,
          expiresAt,
          lastPositionSeconds: dto.positionSeconds ?? session.lastPositionSeconds,
        })
        .where(eq(playbackSessions.id, session.id));
      await tx.update(devices).set({ lastSeenAt: now }).where(eq(devices.id, session.deviceId));
      return { ok: true, expiresAt };
    });
    if (!outcome.ok) {
      throw new AppException(outcome.code);
    }
    return { expiresAt: outcome.expiresAt.toISOString() };
  }

  /** Ends the caller's session (idempotent). */
  async end(userId: string, sessionId: string): Promise<void> {
    const [session] = await this.db
      .select({ id: playbackSessions.id, endedAt: playbackSessions.endedAt })
      .from(playbackSessions)
      .where(and(eq(playbackSessions.id, sessionId), eq(playbackSessions.userId, userId)))
      .limit(1);
    if (!session) throw new AppException('NOT_FOUND');
    if (!session.endedAt) {
      await this.db.update(playbackSessions).set({ endedAt: new Date() }).where(eq(playbackSessions.id, session.id));
    }
  }
}
