import { type DynamicModule, Module } from '@nestjs/common';
import { type Env, isFakeBillingEnabled } from '../config/env.schema';
import { FakeWebhooksController, StoreWebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

@Module({})
export class WebhooksModule {
  /** `billing` is the app's BillingModule instance (pass the same object everywhere). */
  static register(env: Env, billing: DynamicModule): DynamicModule {
    return {
      module: WebhooksModule,
      imports: [billing],
      controllers: [StoreWebhooksController, ...(isFakeBillingEnabled(env) ? [FakeWebhooksController] : [])],
      providers: [WebhooksService],
    };
  }
}
