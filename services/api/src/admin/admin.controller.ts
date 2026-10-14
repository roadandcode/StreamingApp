import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrors } from '../common/api-docs';
import { type AuthUser, CurrentUser, Roles } from '../common/request-context';
import {
  AdminContentDetailDto,
  AdminContentDto,
  AdminContentQueryDto,
  CreateContentDto,
  PaginatedAdminContentDto,
  UpdateContentDto,
  UploadSessionDto,
} from './admin-content.dto';
import { AdminContentService } from './admin-content.service';
import { AdminUserDetailDto, AdminUsersQueryDto, PaginatedAdminUsersDto } from './admin-users.dto';
import { AdminUsersService } from './admin-users.service';
import { UUID_PARAM } from '../common/validation';

@ApiTags('admin: content')
@ApiBearerAuth('bearer')
@Roles('admin')
@ApiErrors('UNAUTHENTICATED', 'ACCOUNT_INACTIVE', 'FORBIDDEN')
@Controller('admin/content')
export class AdminContentController {
  constructor(private readonly contentService: AdminContentService) {}

  @Get()
  @ApiOperation({
    summary: 'List content in any publication state',
    description:
      'Without parentId: top-level items (courses and standalone videos), newest updatedAt first. ' +
      'With parentId: its children by position.',
  })
  @ApiOkResponse({ type: PaginatedAdminContentDto })
  @ApiErrors('VALIDATION_FAILED')
  list(@Query() query: AdminContentQueryDto): Promise<PaginatedAdminContentDto> {
    return this.contentService.list(query);
  }

  @Post()
  @ApiOperation({ summary: 'Create content (starts as draft)' })
  @ApiCreatedResponse({ type: AdminContentDto })
  @ApiErrors('VALIDATION_FAILED')
  create(@CurrentUser() actor: AuthUser, @Body() dto: CreateContentDto): Promise<AdminContentDto> {
    return this.contentService.create(actor.id, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Content with all of its children' })
  @ApiOkResponse({ type: AdminContentDetailDto })
  @ApiErrors('VALIDATION_FAILED', 'NOT_FOUND')
  get(@Param('id', UUID_PARAM) id: string): Promise<AdminContentDetailDto> {
    return this.contentService.get(id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update content',
    description: 'kind and parentId cannot change; null clears ageRating and thumbnailUrl.',
  })
  @ApiOkResponse({ type: AdminContentDto })
  @ApiErrors('VALIDATION_FAILED', 'NOT_FOUND')
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id', UUID_PARAM) id: string,
    @Body() dto: UpdateContentDto,
  ): Promise<AdminContentDto> {
    return this.contentService.update(actor.id, id, dto);
  }

  @Post(':id/upload-session')
  @ApiOperation({
    summary: 'Create (or replace) the video asset and a short-lived upload URL',
    description:
      'PUT the file to uploadUrl with exactly the returned headers (they may be empty); a successful ' +
      'upload answers 204. Uploading again replaces the asset; playback is refused until it is ready. ' +
      '400 VALIDATION_FAILED for a course.',
  })
  @ApiCreatedResponse({ type: UploadSessionDto })
  @ApiErrors('VALIDATION_FAILED', 'NOT_FOUND', 'PROVIDER_NOT_CONFIGURED')
  uploadSession(@CurrentUser() actor: AuthUser, @Param('id', UUID_PARAM) id: string): Promise<UploadSessionDto> {
    return this.contentService.createUploadSession(actor.id, id);
  }

  @Post(':id/publish')
  @HttpCode(200)
  @ApiOperation({ summary: 'Publish; lessons and videos need a ready video asset' })
  @ApiOkResponse({ type: AdminContentDto })
  @ApiErrors('VALIDATION_FAILED', 'NOT_FOUND', 'ASSET_NOT_READY', 'PROVIDER_NOT_CONFIGURED')
  publish(@CurrentUser() actor: AuthUser, @Param('id', UUID_PARAM) id: string): Promise<AdminContentDto> {
    return this.contentService.publish(actor.id, id);
  }

  @Post(':id/unpublish')
  @HttpCode(200)
  @ApiOperation({ summary: 'Unpublish; open playback sessions end at their next heartbeat' })
  @ApiOkResponse({ type: AdminContentDto })
  @ApiErrors('VALIDATION_FAILED', 'NOT_FOUND')
  unpublish(@CurrentUser() actor: AuthUser, @Param('id', UUID_PARAM) id: string): Promise<AdminContentDto> {
    return this.contentService.unpublish(actor.id, id);
  }
}

@ApiTags('admin: users')
@ApiBearerAuth('bearer')
@Roles('admin')
@ApiErrors('UNAUTHENTICATED', 'ACCOUNT_INACTIVE', 'FORBIDDEN')
@Controller('admin')
export class AdminUsersController {
  constructor(private readonly usersService: AdminUsersService) {}

  @Get('users')
  @ApiOperation({ summary: 'Find users by email substring' })
  @ApiOkResponse({ type: PaginatedAdminUsersDto })
  @ApiErrors('VALIDATION_FAILED')
  list(@Query() query: AdminUsersQueryDto): Promise<PaginatedAdminUsersDto> {
    return this.usersService.list(query);
  }

  @Get('users/:id')
  @ApiOperation({ summary: 'User support view: subscription, devices and active playback' })
  @ApiOkResponse({ type: AdminUserDetailDto })
  @ApiErrors('VALIDATION_FAILED', 'NOT_FOUND')
  detail(@Param('id', UUID_PARAM) id: string): Promise<AdminUserDetailDto> {
    return this.usersService.detail(id);
  }

  @Post('users/:id/sessions/revoke')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke all login sessions of a user' })
  @ApiNoContentResponse({ description: 'Sessions revoked.' })
  @ApiErrors('VALIDATION_FAILED', 'NOT_FOUND')
  async revokeSessions(@CurrentUser() actor: AuthUser, @Param('id', UUID_PARAM) id: string): Promise<void> {
    await this.usersService.revokeLoginSessions(actor.id, id);
  }

  @Post('devices/:id/revoke')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Block a device permanently and end its playback sessions',
    description: 'Registering it again returns 403 DEVICE_REVOKED.',
  })
  @ApiNoContentResponse({ description: 'Device revoked.' })
  @ApiErrors('VALIDATION_FAILED', 'NOT_FOUND')
  async revokeDevice(@CurrentUser() actor: AuthUser, @Param('id', UUID_PARAM) id: string): Promise<void> {
    await this.usersService.revokeDevice(actor.id, id);
  }

  @Post('playback-sessions/:id/revoke')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke a playback session' })
  @ApiNoContentResponse({ description: 'Playback session revoked.' })
  @ApiErrors('VALIDATION_FAILED', 'NOT_FOUND')
  async revokePlaybackSession(@CurrentUser() actor: AuthUser, @Param('id', UUID_PARAM) id: string): Promise<void> {
    await this.usersService.revokePlaybackSession(actor.id, id);
  }
}
