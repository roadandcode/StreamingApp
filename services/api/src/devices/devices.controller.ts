import { Body, Controller, Delete, Get, HttpCode, Param, Post, Res } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ApiErrors } from '../common/api-docs';
import { type AuthUser, CurrentUser } from '../common/request-context';
import { DeviceDto, RegisterDeviceDto } from './device.dto';
import { DevicesService } from './devices.service';
import { UUID_PARAM } from '../common/validation';

@ApiTags('devices')
@ApiBearerAuth('bearer')
@ApiErrors('UNAUTHENTICATED', 'ACCOUNT_INACTIVE')
@Controller('me/devices')
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Get()
  @ApiOperation({ summary: 'Active (not revoked) devices of the signed-in user' })
  @ApiOkResponse({ type: DeviceDto, isArray: true })
  list(@CurrentUser() user: AuthUser): Promise<DeviceDto[]> {
    return this.devices.listActive(user.id);
  }

  @Post()
  @ApiOperation({
    summary: 'Register this installation as a device',
    description: '`201` for a new device, `200` when this installation was already registered.',
  })
  @ApiCreatedResponse({ type: DeviceDto, description: 'New device' })
  @ApiOkResponse({ type: DeviceDto, description: 'Installation already registered' })
  @ApiErrors('VALIDATION_FAILED', 'DEVICE_REVOKED', 'DEVICE_LIMIT_REACHED')
  async register(
    @CurrentUser() user: AuthUser,
    @Body() dto: RegisterDeviceDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<DeviceDto> {
    const result = await this.devices.register(user.id, dto);
    response.status(result.created ? 201 : 200);
    return result.device;
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke a device and end its playback sessions' })
  @ApiNoContentResponse({ description: 'Device revoked.' })
  @ApiErrors('VALIDATION_FAILED', 'NOT_FOUND')
  async revoke(@CurrentUser() user: AuthUser, @Param('id', UUID_PARAM) id: string): Promise<void> {
    await this.devices.revokeOwn(user.id, id);
  }
}
