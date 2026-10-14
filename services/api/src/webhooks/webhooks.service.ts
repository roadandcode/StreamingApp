import type { IncomingHttpHeaders } from 'node:http';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { BillingService } from '../billing/billing.service';
import { type Database, DRIZZLE } from '../database/database.types';
import type { BillingProvider } from '../database/schema';
import { DrizzleProviderEventStore, hashPayload } from './drizzle-provider-event-store';
import { processProviderEventOnce } from './provider-event-dedupe';

export interface WebhookResult {
  duplicate: boolean;
}

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger('Webhooks');
  private readonly store: DrizzleProviderEventStore;

  constructor(
    @Inject(DRIZZLE) db: Database,
    private readonly billing: BillingService,
  ) {
    this.store = new DrizzleProviderEventStore(db);
  }

  /**
   * Verify authenticity first (the provider's verifier throws on a bad signature), then store the
   * event once by (provider, eventId) and apply it in the same transaction.
   */
  async handle(provider: BillingProvider, rawBody: Buffer | undefined, headers: IncomingHttpHeaders): Promise<WebhookResult> {
    const notification = await this.billing.verifier(provider).parseNotification(rawBody, headers);
    const result = await processProviderEventOnce(
      this.store,
      { provider, eventId: notification.eventId, payloadHash: hashPayload(rawBody ?? Buffer.alloc(0)) },
      (tx) => this.billing.applyNotification(tx, provider, notification, new Date()),
    );
    if (result.outcome?.status === 'skipped') {
      this.logger.warn(`Skipped ${provider} event: ${result.outcome.note ?? 'no reason'}`);
    }
    return { duplicate: result.duplicate };
  }
}
