import { type DynamicModule, Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppConfig } from './app-config';
import { parseEnv } from './env.schema';

@Global()
@Module({})
export class AppConfigModule {
  /**
   * Validates `process.env` with the zod schema when the app is built (not at import time). The
   * entry points load `services/api/.env` into `process.env` first (see load-env-file.ts); tests set
   * their environment explicitly, so ConfigModule itself never reads a file.
   */
  static register(): DynamicModule {
    return {
      module: AppConfigModule,
      imports: [ConfigModule.forRoot({ ignoreEnvFile: true, validate: parseEnv })],
      providers: [AppConfig],
      exports: [AppConfig],
    };
  }
}
