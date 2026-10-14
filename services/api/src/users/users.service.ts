import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { revokeAllUserSessions } from '../auth/session-store';
import { AppException } from '../common/errors';
import { type Database, DRIZZLE } from '../database/database.types';
import { devices, users } from '../database/schema';
import { revokePlaybackSessions } from '../playback/session-revocation';
import { toUserDto, type UserDto } from './user.dto';

@Injectable()
export class UsersService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async getById(userId: string): Promise<UserDto> {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw new AppException('NOT_FOUND');
    return toUserDto(user);
  }

  /**
   * Soft-deletes the account: status `deleted`, and every login session, device and playback session
   * is revoked in the same transaction. Store subscriptions keep their billing history.
   */
  async deleteAccount(userId: string): Promise<void> {
    const now = new Date();
    await this.db.transaction(async (tx) => {
      const [user] = await tx
        .update(users)
        .set({ accountStatus: 'deleted', deletedAt: now })
        .where(eq(users.id, userId))
        .returning({ id: users.id });
      if (!user) throw new AppException('NOT_FOUND');
      await revokeAllUserSessions(tx, userId, now);
      await tx
        .update(devices)
        .set({ revokedAt: now })
        .where(and(eq(devices.userId, userId), isNull(devices.revokedAt)));
      await revokePlaybackSessions(tx, { userId }, 'ACCOUNT_DELETED', now);
      await this.audit.record(tx, {
        actorUserId: userId,
        action: 'account.delete',
        targetType: 'user',
        targetId: userId,
      });
    });
  }
}
