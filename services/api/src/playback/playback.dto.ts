import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayUnique, IsArray, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { DRM_SYSTEMS, type DrmSystem } from '../common/enums';
import { EachElement } from '../common/validation';

export class CreatePlaybackSessionDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  contentId: string;

  @ApiProperty({ format: 'uuid', description: 'A device registered with POST /v1/me/devices' })
  @IsUUID()
  deviceId: string;

  @ApiPropertyOptional({
    enum: DRM_SYSTEMS,
    enumName: 'DrmSystem',
    isArray: true,
    description: 'DRM systems this client can play (browsers: what EME supports; Android: ["widevine"]).',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(DRM_SYSTEMS.length)
  @ArrayUnique()
  @EachElement('isDrmSystem', (v) => (DRM_SYSTEMS as readonly unknown[]).includes(v), `one of ${DRM_SYSTEMS.join(', ')}`)
  supportedDrm?: DrmSystem[];
}

export class HeartbeatDto {
  @ApiPropertyOptional({ minimum: 0, description: 'Current playback position' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  positionSeconds?: number;
}

export class DrmDto {
  @ApiProperty({ enum: DRM_SYSTEMS, enumName: 'DrmSystem' })
  system: DrmSystem;

  @ApiProperty()
  licenseUrl: string;

  @ApiProperty({ type: String, nullable: true, description: 'FairPlay application certificate' })
  certificateUrl: string | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string' },
    description:
      'Headers to send on every license request, exactly as given (they carry the short-lived license ' +
      'token; names depend on the DRM vendor). Treat the values as secrets.',
  })
  licenseRequestHeaders: Record<string, string>;
}

export class PlaybackAuthorizationDto {
  @ApiProperty({ format: 'uuid' })
  playbackSessionId: string;

  @ApiProperty({ format: 'uuid' })
  contentId: string;

  @ApiProperty({ description: 'Short-lived; never a permanent public URL' })
  manifestUrl: string;

  @ApiProperty({ format: 'date-time', description: 'Playback authorization expiry, extended by heartbeats' })
  expiresAt: string;

  @ApiProperty({ example: 30 })
  heartbeatIntervalSeconds: number;

  @ApiProperty({ type: DrmDto, nullable: true })
  drm: DrmDto | null;
}

export class HeartbeatResponseDto {
  @ApiProperty({ format: 'date-time' })
  expiresAt: string;
}
