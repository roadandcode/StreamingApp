import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';
import { PLATFORMS } from '../common/enums';
import type { DeviceRow, Platform } from '../database/schema';

export class RegisterDeviceDto {
  @ApiProperty({ format: 'uuid', description: 'Generated once by the app and kept in secure storage.' })
  @IsUUID()
  installationId: string;

  @ApiProperty({ enum: PLATFORMS, enumName: 'Platform' })
  @IsIn(PLATFORMS)
  platform: Platform;

  @ApiProperty({ maxLength: 100, example: 'Pixel 8' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;
}

export class DeviceDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  installationId: string;

  @ApiProperty({ enum: PLATFORMS, enumName: 'Platform' })
  platform: Platform;

  @ApiProperty()
  name: string;

  @ApiProperty({ format: 'date-time' })
  lastSeenAt: string;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  revokedAt: string | null;
}

export function toDeviceDto(device: DeviceRow): DeviceDto {
  return {
    id: device.id,
    installationId: device.installationId,
    platform: device.platform,
    name: device.name,
    lastSeenAt: device.lastSeenAt.toISOString(),
    createdAt: device.createdAt.toISOString(),
    revokedAt: device.revokedAt?.toISOString() ?? null,
  };
}
