import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle, ThrottlerGuard } from '@nestjs/throttler';
import { ApiErrors } from '../common/api-docs';
import { Public } from '../common/request-context';
import { AuthResponseDto, LoginDto, RefreshResponseDto, RefreshTokenDto, RegisterDto } from './auth.dto';
import { AuthService } from './auth.service';

@ApiTags('auth')
@Public()
@UseGuards(ThrottlerGuard)
@SkipThrottle({ playback: true })
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @ApiOperation({ summary: 'Create a viewer account and sign in' })
  @ApiCreatedResponse({ type: AuthResponseDto })
  @ApiErrors('VALIDATION_FAILED', 'EMAIL_TAKEN', 'RATE_LIMITED')
  register(@Body() dto: RegisterDto): Promise<AuthResponseDto> {
    return this.auth.register(dto);
  }

  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sign in with email and password' })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiErrors('VALIDATION_FAILED', 'INVALID_CREDENTIALS', 'ACCOUNT_INACTIVE', 'RATE_LIMITED')
  login(@Body() dto: LoginDto): Promise<AuthResponseDto> {
    return this.auth.login(dto);
  }

  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Exchange a refresh token for new tokens',
    description:
      'Rotates the refresh token. Presenting an already-rotated token revokes the whole session family.',
  })
  @ApiOkResponse({ type: RefreshResponseDto })
  @ApiErrors('VALIDATION_FAILED', 'INVALID_REFRESH_TOKEN', 'RATE_LIMITED')
  refresh(@Body() dto: RefreshTokenDto): Promise<RefreshResponseDto> {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke the session the refresh token belongs to' })
  @ApiNoContentResponse({ description: 'Session revoked (also returned for unknown tokens).' })
  @ApiErrors('VALIDATION_FAILED', 'RATE_LIMITED')
  async logout(@Body() dto: RefreshTokenDto): Promise<void> {
    await this.auth.logout(dto.refreshToken);
  }
}
