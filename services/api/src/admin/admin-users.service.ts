import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gt, ilike, isNull } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { revokeAllUserSessions } from '../auth/session-store';
import { BillingService } from '../billing/billing.service';
import { AppException } from '../common/errors';
import { toPageRequest } from '../common/pagination';
import { AppConfig } from '../config/app-config';
import { type Database, DRIZZLE } from '../database/database.types';
import { content, devices, playbackSessions, users } from '../database/schema';
import { DevicesService } from '../devices/devices.service';
import { revokePlaybackSessions } from '../playback/session-revocation';
import { toUserDto } from '../users/user.dto';
import type { AdminUserDetailDto, AdminUsersQueryDto, PaginatedAdminUsersDto } from './admin-users.dto';

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

@Injectable()
export class AdminUsersService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly billing: BillingService,
    private readonly devices: DevicesService,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
  ) {}

  async list(query: AdminUsersQueryDto): Promise<PaginatedAdminUsersDto> {
    const { page, pageSize, offset } = toPageRequest(query);
    const email = query.email?.trim();
    const where = email ? ilike(users.email, `%${escapeLike(email.toLowerCase())}%`) : undefined;
    const [rows, [totalRow]] = await Promise.all([
      this.db
        .select()
        .from(users)
        .where(where)
        .orderBy(desc(users.createdAt), asc(users.id))
        .limit(pageSize)
        .offset(offset),
      this.db.select({ total: count() }).from(users).where(where),
    ]);
    const views = await this.billing.getViews(
      this.db,
      rows.map((u) => u.id),
    );
    return {
      items: rows.map((u) => ({ user: toUserDto(u), subscription: views.get(u.id)! })),
      page,
      pageSize,
      total: totalRow?.total ?? 0,
    };
  }

  async detail(userId: string): Promise<AdminUserDetailDto> {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw new AppException('NOT_FOUND');
    const now = new Date();
    const staleBefore = new Date(now.getTime() - this.config.playbackStaleAfterSeconds * 1000);
    const [subscription, deviceList, sessions] = await Promise.all([
      this.billing.getView(userId, now),
      this.devices.listAll(this.db, userId),
      this.db
        .select({
          id: playbackSessions.id,
          contentId: playbackSessions.contentId,
          contentTitle: content.title,
          deviceId: playbackSessions.deviceId,
          startedAt: playbackSessions.startedAt,
          lastHeartbeatAt: playbackSessions.lastHeartbeatAt,
        })
        .from(playbackSessions)
        .innerJoin(content, eq(content.id, playbackSessions.contentId))
        .where(
          and(
            eq(playbackSessions.userId, userId),
            isNull(playbackSessions.endedAt),
            isNull(playbackSessions.revokedAt),
            gt(playbackSessions.lastHeartbeatAt, staleBefore),
            gt(playbackSessions.expiresAt, now),
          ),
        )
        .orderBy(desc(playbackSessions.startedAt)),
    ]);
    return {
      user: toUserDto(user),
      subscription,
      devices: deviceList,
      activePlaybackSessions: sessions.map((s) => ({
        ...s,
        startedAt: s.startedAt.toISOString(),
        lastHeartbeatAt: s.lastHeartbeatAt.toISOString(),
      })),
    };
  }

  /** Revokes every login session of the user; their access tokens stop working immediately. */
  async revokeLoginSessions(actorId: string, userId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [user] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
      if (!user) throw new AppException('NOT_FOUND');
      const revoked = await revokeAllUserSessions(tx, userId, new Date());
      await this.audit.record(tx, {
        actorUserId: actorId,
        action: 'user.sessions.revoke',
        targetType: 'user',
        targetId: userId,
        metadata: { revokedSessions: revoked },
      });
    });
  }

  async revokeDevice(actorId: string, deviceId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [device] = await tx.select().from(devices).where(eq(devices.id, deviceId)).for('update').limit(1);
      if (!device) throw new AppException('NOT_FOUND');
      await this.devices.revokeDevice(tx, device, new Date());
      await this.audit.record(tx, {
        actorUserId: actorId,
        action: 'device.revoke',
        targetType: 'device',
        targetId: deviceId,
        metadata: { userId: device.userId },
      });
    });
  }

  async revokePlaybackSession(actorId: string, sessionId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [session] = await tx
        .select({ id: playbackSessions.id, userId: playbackSessions.userId })
        .from(playbackSessions)
        .where(eq(playbackSessions.id, sessionId))
        .limit(1);
      if (!session) throw new AppException('NOT_FOUND');
      await revokePlaybackSessions(tx, { sessionId }, 'ADMIN_REVOKED', new Date());
      await this.audit.record(tx, {
        actorUserId: actorId,
        action: 'playback_session.revoke',
        targetType: 'playback_session',
        targetId: sessionId,
        metadata: { userId: session.userId },
      });
    });
  }
}
