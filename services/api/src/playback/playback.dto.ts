import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class CreatePlaybackSessionDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  contentId: string;

  @ApiProperty({ format: 'uuid', description: 'A device registered with POST /v1/me/devices' })
  @IsUUID()
  deviceId: string;
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
  @ApiProperty({ enum: ['widevine', 'fairplay'], enumName: 'DrmSystem' })
  system: 'widevine' | 'fairplay';

  @ApiProperty()
  licenseUrl: string;

  @ApiProperty({ type: String, nullable: true, description: 'FairPlay application certificate' })
  certificateUrl: string | null;

  @ApiProperty({ description: 'Short-lived license token' })
  token: string;
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
