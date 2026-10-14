import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { SubscriptionViewDto } from '../billing/billing.dto';
import { PaginationQueryDto } from '../common/pagination';
import { DeviceDto } from '../devices/device.dto';
import { UserDto } from '../users/user.dto';

export class AdminUsersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Case-insensitive substring of the email' })
  @IsOptional()
  @IsString()
  @MaxLength(254)
  email?: string;
}

export class AdminUserListItemDto {
  @ApiProperty({ type: UserDto })
  user: UserDto;

  @ApiProperty({ type: SubscriptionViewDto })
  subscription: SubscriptionViewDto;
}

export class PaginatedAdminUsersDto {
  @ApiProperty({ type: AdminUserListItemDto, isArray: true })
  items: AdminUserListItemDto[];

  @ApiProperty()
  page: number;

  @ApiProperty()
  pageSize: number;

  @ApiProperty()
  total: number;
}

export class ActivePlaybackSessionDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  contentId: string;

  @ApiProperty()
  contentTitle: string;

  @ApiProperty({ format: 'uuid' })
  deviceId: string;

  @ApiProperty({ format: 'date-time' })
  startedAt: string;

  @ApiProperty({ format: 'date-time' })
  lastHeartbeatAt: string;
}

export class AdminUserDetailDto {
  @ApiProperty({ type: UserDto })
  user: UserDto;

  @ApiProperty({ type: SubscriptionViewDto })
  subscription: SubscriptionViewDto;

  @ApiProperty({ type: DeviceDto, isArray: true, description: 'Including revoked devices' })
  devices: DeviceDto[];

  @ApiProperty({ type: ActivePlaybackSessionDto, isArray: true })
  activePlaybackSessions: ActivePlaybackSessionDto[];
}
