import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { sql } from 'drizzle-orm';
import { ApiErrors } from '../common/api-docs';
import { AppException } from '../common/errors';
import { Public } from '../common/request-context';
import { type Database, DRIZZLE } from '../database/database.types';

export class HealthDto {
  @ApiProperty({ enum: ['ok'] })
  status: 'ok';

  @ApiProperty({ enum: ['ok'] })
  db: 'ok';
}

@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  @Get()
  @ApiOperation({ summary: 'Liveness and database connectivity' })
  @ApiOkResponse({ type: HealthDto })
  @ApiErrors('SERVICE_UNAVAILABLE')
  async check(): Promise<HealthDto> {
    try {
      await this.db.execute(sql`select 1`);
    } catch {
      throw new AppException('SERVICE_UNAVAILABLE', 'Database is unavailable.');
    }
    return { status: 'ok', db: 'ok' };
  }
}
