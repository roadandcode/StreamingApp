import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';
import { AppConfig } from '../config/app-config';
import { createDatabase, createPool } from './connection';
import { DRIZZLE, PG_POOL } from './database.types';

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [AppConfig],
      useFactory: (config: AppConfig) => createPool(config.get('DATABASE_URL')),
    },
    {
      provide: DRIZZLE,
      inject: [PG_POOL],
      useFactory: (pool: Pool) => createDatabase(pool),
    },
  ],
  exports: [DRIZZLE, PG_POOL],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
