import { type DynamicModule, Inject, type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { AdminModule } from './admin/admin.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { BillingModule } from './billing/billing.module';
import { CatalogModule } from './catalog/catalog.module';
import { CountryMiddleware } from './common/country';
import { RequestLoggerMiddleware } from './common/request-logger.middleware';
import { AppConfig } from './config/app-config';
import { AppConfigModule } from './config/config.module';
import type { Env } from './config/env.schema';
import { DatabaseModule } from './database/database.module';
import { DevicesModule } from './devices/devices.module';
import { EntitlementsModule } from './entitlements/entitlements.module';
import { HealthModule } from './health/health.module';
import { MediaModule } from './media/media.module';
import { PlaybackModule } from './playback/playback.module';
import { UsersModule } from './users/users.module';
import { WebhooksModule } from './webhooks/webhooks.module';

export interface AppModuleOptions {
  /** Access log of method, path and status (off in tests). */
  requestLogging?: boolean;
}

const APP_MODULE_OPTIONS = Symbol('APP_MODULE_OPTIONS');

/**
 * The modular monolith. Built from the validated environment because provider selection and the
 * fake-only routes (`/v1/dev/*`, `/v1/webhooks/fake`) are decided at startup.
 */
@Module({})
export class AppModule implements NestModule {
  constructor(@Inject(APP_MODULE_OPTIONS) private readonly options: AppModuleOptions) {}

  static register(env: Env, options: AppModuleOptions = {}): DynamicModule {
    const media = MediaModule.register(env);
    const billing = BillingModule.register(env);
    return {
      module: AppModule,
      imports: [
        AppConfigModule.register(),
        DatabaseModule,
        ThrottlerModule.forRootAsync({
          inject: [AppConfig],
          useFactory: (config: AppConfig) => ({
            throttlers: [
              {
                name: 'auth',
                limit: config.get('THROTTLE_AUTH_LIMIT'),
                ttl: config.get('THROTTLE_AUTH_TTL_SECONDS') * 1000,
              },
              {
                name: 'playback',
                limit: config.get('THROTTLE_PLAYBACK_LIMIT'),
                ttl: config.get('THROTTLE_PLAYBACK_TTL_SECONDS') * 1000,
              },
            ],
          }),
        }),
        AuditModule,
        AuthModule,
        UsersModule,
        CatalogModule,
        media,
        billing,
        EntitlementsModule,
        DevicesModule,
        PlaybackModule.register(media),
        WebhooksModule.register(env, billing),
        AdminModule.register(media, billing),
        HealthModule,
      ],
      providers: [{ provide: APP_MODULE_OPTIONS, useValue: options }],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    const middleware = this.options.requestLogging === false ? [CountryMiddleware] : [RequestLoggerMiddleware, CountryMiddleware];
    consumer.apply(...middleware).forRoutes('{*splat}');
  }
}
