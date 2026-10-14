import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq, isNull } from 'drizzle-orm';
import { AppException } from '../common/errors';
import { AppConfig } from '../config/app-config';
import { type Database, DRIZZLE, type Executor } from '../database/database.types';
import { type DeviceRevokedBy, type DeviceRow, devices, users } from '../database/schema';
import { revokePlaybackSessions } from '../playback/session-revocation';
import { type DeviceDto, type RegisterDeviceDto, toDeviceDto } from './device.dto';

export interface RegisterDeviceResult {
  device: DeviceDto;
  created: boolean;
}

@Injectable()
export class DevicesService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly config: AppConfig,
  ) {}

  async listActive(userId: string): Promise<DeviceDto[]> {
    const rows = await this.db
      .select()
      .from(devices)
      .where(and(eq(devices.userId, userId), isNull(devices.revokedAt)))
      .orderBy(asc(devices.createdAt));
    return rows.map(toDeviceDto);
  }

  async listAll(executor: Executor, userId: string): Promise<DeviceDto[]> {
    const rows = await executor.select().from(devices).where(eq(devices.userId, userId)).orderBy(asc(devices.createdAt));
    return rows.map(toDeviceDto);
  }

  /**
   * Registers an installation for the user. Re-registering the same installation refreshes it
   * (`created: false`), re-activating it if its owner had removed it; a device an admin blocked stays
   * revoked. At most MAX_DEVICES devices are active.
   */
  async register(userId: string, dto: RegisterDeviceDto): Promise<RegisterDeviceResult> {
    const now = new Date();
    return this.db.transaction(async (tx) => {
      // Serialize registrations per user so the device limit cannot be raced.
      await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');

      const [existing] = await tx
        .select()
        .from(devices)
        .where(and(eq(devices.userId, userId), eq(devices.installationId, dto.installationId)))
        .limit(1);
      if (existing?.revokedAt && existing.revokedBy !== 'user') {
        throw new AppException('DEVICE_REVOKED');
      }
      if (existing && !existing.revokedAt) {
        const [updated] = await tx
          .update(devices)
          .set({ platform: dto.platform, name: dto.name, lastSeenAt: now })
          .where(eq(devices.id, existing.id))
          .returning();
        return { device: toDeviceDto(updated ?? existing), created: false };
      }

      // A new device, or one its owner removed earlier: both count against the limit.
      const [{ active } = { active: 0 }] = await tx
        .select({ active: count() })
        .from(devices)
        .where(and(eq(devices.userId, userId), isNull(devices.revokedAt)));
      if (active >= this.config.get('MAX_DEVICES')) {
        throw new AppException('DEVICE_LIMIT_REACHED');
      }
      if (existing) {
        const [reactivated] = await tx
          .update(devices)
          .set({ platform: dto.platform, name: dto.name, lastSeenAt: now, revokedAt: null, revokedBy: null })
          .where(eq(devices.id, existing.id))
          .returning();
        return { device: toDeviceDto(reactivated ?? existing), created: false };
      }
      const [created] = await tx
        .insert(devices)
        .values({
          userId,
          installationId: dto.installationId,
          platform: dto.platform,
          name: dto.name,
          lastSeenAt: now,
        })
        .returning();
      if (!created) throw new Error('Device insert returned no row');
      return { device: toDeviceDto(created), created: true };
    });
  }

  /** The owner removes one of their devices; they can register it again later. */
  async revokeOwn(userId: string, deviceId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [device] = await tx
        .select()
        .from(devices)
        .where(and(eq(devices.id, deviceId), eq(devices.userId, userId)))
        .limit(1);
      if (!device) throw new AppException('NOT_FOUND');
      await this.revokeDevice(tx, device, 'user', new Date());
    });
  }

  /**
   * Revokes the device and ends its open playback sessions. An admin revocation is a permanent
   * block and also upgrades an earlier removal by the owner.
   */
  async revokeDevice(executor: Executor, device: DeviceRow, by: DeviceRevokedBy, now: Date): Promise<void> {
    if (!device.revokedAt) {
      await executor.update(devices).set({ revokedAt: now, revokedBy: by }).where(eq(devices.id, device.id));
    } else if (by === 'admin' && device.revokedBy !== 'admin') {
      await executor.update(devices).set({ revokedBy: 'admin' }).where(eq(devices.id, device.id));
    }
    await revokePlaybackSessions(executor, { deviceId: device.id }, 'DEVICE_REVOKED', now);
  }
}
