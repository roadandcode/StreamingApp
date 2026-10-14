import { Body, Controller, Delete, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { SkipThrottle, ThrottlerGuard } from '@nestjs/throttler';
import { ApiErrors } from '../common/api-docs';
import { type AuthUser, CurrentUser, ViewerCountry } from '../common/request-context';
import {
  CreatePlaybackSessionDto,
  HeartbeatDto,
  HeartbeatResponseDto,
  PlaybackAuthorizationDto,
} from './playback.dto';
import { PlaybackService } from './playback.service';

@ApiTags('playback')
@ApiBearerAuth('bearer')
@UseGuards(ThrottlerGuard)
@SkipThrottle({ auth: true })
@ApiErrors('UNAUTHENTICATED', 'ACCOUNT_INACTIVE', 'RATE_LIMITED')
@Controller('playback/sessions')
export class PlaybackController {
  constructor(private readonly playback: PlaybackService) {}

  @Post()
  @ApiOperation({
    summary: 'Authorize playback of one content item on one device',
    description:
      'Checks, in order: account active, content published and available in the country, ready video ' +
      'asset, entitlement for premium content, device registered and not revoked, concurrent streams.',
  })
  @ApiCreatedResponse({ type: PlaybackAuthorizationDto })
  @ApiErrors(
    'VALIDATION_FAILED',
    'NOT_FOUND',
    'REGION_NOT_ALLOWED',
    'CONTENT_NOT_PLAYABLE',
    'ENTITLEMENT_REQUIRED',
    'DEVICE_NOT_REGISTERED',
    'DEVICE_REVOKED',
    'CONCURRENT_STREAM_LIMIT',
    'PROVIDER_NOT_CONFIGURED',
  )
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreatePlaybackSessionDto,
    @ViewerCountry() country: string,
  ): Promise<PlaybackAuthorizationDto> {
    return this.playback.createSession(user.id, dto, country);
  }

  @Post(':id/heartbeat')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Keep a playback session alive',
    description:
      'Re-checks account, content publication and region, entitlement and device. On failure the session ' +
      'is revoked and the error code returned; stop the player on any 403.',
  })
  @ApiOkResponse({ type: HeartbeatResponseDto })
  @ApiErrors(
    'VALIDATION_FAILED',
    'NOT_FOUND',
    'REGION_NOT_ALLOWED',
    'ENTITLEMENT_REQUIRED',
    'DEVICE_NOT_REGISTERED',
    'DEVICE_REVOKED',
    'PLAYBACK_SESSION_ENDED',
  )
  heartbeat(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: HeartbeatDto,
    @ViewerCountry() country: string,
  ): Promise<HeartbeatResponseDto> {
    return this.playback.heartbeat(user.id, id, dto, country);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'End a playback session' })
  @ApiNoContentResponse({ description: 'Session ended.' })
  @ApiErrors('VALIDATION_FAILED', 'NOT_FOUND')
  async end(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.playback.end(user.id, id);
  }
}
