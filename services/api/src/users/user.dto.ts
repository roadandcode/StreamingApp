import { ApiProperty } from '@nestjs/swagger';
import { ACCOUNT_STATUSES, ROLES } from '../common/enums';
import type { AccountStatus, Role, UserRow } from '../database/schema';

export class UserDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'email' })
  email: string;

  @ApiProperty({ type: String, nullable: true })
  displayName: string | null;

  @ApiProperty({ enum: ROLES, enumName: 'Role' })
  role: Role;

  @ApiProperty({ enum: ACCOUNT_STATUSES, enumName: 'AccountStatus' })
  accountStatus: AccountStatus;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;
}

export function toUserDto(user: Pick<UserRow, 'id' | 'email' | 'displayName' | 'role' | 'accountStatus' | 'createdAt'>): UserDto {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    accountStatus: user.accountStatus,
    createdAt: user.createdAt.toISOString(),
  };
}
