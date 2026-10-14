import { Controller, Delete, Get, HttpCode } from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrors } from '../common/api-docs';
import { type AuthUser, CurrentUser } from '../common/request-context';
import { UserDto } from './user.dto';
import { UsersService } from './users.service';

@ApiTags('account')
@ApiBearerAuth('bearer')
@ApiErrors('UNAUTHENTICATED', 'ACCOUNT_INACTIVE')
@Controller('me')
export class MeController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'The signed-in user' })
  @ApiOkResponse({ type: UserDto })
  me(@CurrentUser() user: AuthUser): Promise<UserDto> {
    return this.users.getById(user.id);
  }

  @Delete()
  @HttpCode(204)
  @ApiOperation({
    summary: 'Delete the account',
    description: 'Soft-deletes the account and revokes all login sessions, devices and playback sessions.',
  })
  @ApiNoContentResponse({ description: 'Account deleted.' })
  async deleteMe(@CurrentUser() user: AuthUser): Promise<void> {
    await this.users.deleteAccount(user.id);
  }
}
