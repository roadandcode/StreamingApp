import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq, isNull } from 'drizzle-orm';
import { AppException } from '../common/errors';
import { AppConfig } from '../config/app-config';
import { type Database, DRIZZLE, type Executor } from '../database/database.types';
import { type DeviceRow, devices, users } from '../database/schema';
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
   * (`created: false`); a revoked installation stays revoked; at most MAX_DEVICES active devices.
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
      if (existing) {
        if (existing.revokedAt) {
          throw new AppException('DEVICE_REVOKED');
        }
        const [updated] = await tx
          .update(devices)
          .set({ platform: dto.platform, name: dto.name, lastSeenAt: now })
          .where(eq(devices.id, existing.id))
          .returning();
        return { device: toDeviceDto(updated ?? existing), created: false };
      }

      const [{ active } = { active: 0 }] = await tx
        .select({ active: count() })
        .from(devices)
        .where(and(eq(devices.userId, userId), isNull(devices.revokedAt)));
      if (active >= this.config.get('MAX_DEVICES')) {
        throw new AppException('DEVICE_LIMIT_REACHED');
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

  /** User-initiated revocation of one of their own devices. */
  async revokeOwn(userId: string, deviceId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [device] = await tx
        .select()
        .from(devices)
        .where(and(eq(devices.id, deviceId), eq(devices.userId, userId)))
        .limit(1);
      if (!device) throw new AppException('NOT_FOUND');
      await this.revokeDevice(tx, device, new Date());
    });
  }

  /** Revokes the device (idempotent) and ends its open playback sessions. */
  async revokeDevice(executor: Executor, device: DeviceRow, now: Date): Promise<void> {
    if (!device.revokedAt) {
      await executor.update(devices).set({ revokedAt: now }).where(eq(devices.id, device.id));
    }
    await revokePlaybackSessions(executor, { deviceId: device.id }, 'DEVICE_REVOKED', now);
  }
}
