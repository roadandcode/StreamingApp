import { createHmac } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AppException } from '../common/errors';
import { AppConfig } from '../config/app-config';
import { signaturesMatch } from '../media/fake-media-signing';
import { addBillingPeriod } from './billing-period';
import type { BillingVerifier, ParsedNotification, VerifiedSubscriptionState } from './billing-verifier';
import { PlansService } from './plans.service';

export const FAKE_SIGNATURE_HEADER = 'x-fake-signature';

export const FAKE_EVENT_TYPES = [
  'RENEWED',
  'CANCELLED',
  'EXPIRED',
  'REFUNDED',
  'REVOKED',
  'GRACE_PERIOD',
  'BILLING_RETRY',
] as const;
export type FakeEventType = (typeof FAKE_EVENT_TYPES)[number];

const fakeEventSchema = z.strictObject({
  eventId: z.string().min(1).max(200),
  type: z.enum(FAKE_EVENT_TYPES),
  originalTransactionId: z.string().min(1).max(500),
  expiresAt: z.iso.datetime({ offset: true }).optional(),
});

export type FakeEvent = z.infer<typeof fakeEventSchema>;

export function signFakeWebhookBody(secret: string, rawBody: Buffer | string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

/** Maps a fake store event onto normalized subscription changes. */
export function mapFakeEvent(event: FakeEvent): ParsedNotification {
  const expiresAt = event.expiresAt ? new Date(event.expiresAt) : undefined;
  const base = {
    eventId: event.eventId,
    occurredAt: null,
    originalTransactionId: event.originalTransactionId,
    transactionId: null,
    currentPeriodEnd: expiresAt,
  };
  switch (event.type) {
    case 'RENEWED':
      return {
        ...base,
        transactionId: `${event.originalTransactionId}:renewal:${event.eventId}`,
        status: 'active',
        extendOnePeriod: !expiresAt,
        autoRenew: true,
        cancelAtPeriodEnd: false,
      };
    case 'CANCELLED':
      return { ...base, status: 'cancelled', autoRenew: false, cancelAtPeriodEnd: true };
    case 'EXPIRED':
      return { ...base, status: 'expired', autoRenew: false };
    case 'REFUNDED':
      return { ...base, status: 'refunded', autoRenew: false, refunded: true };
    case 'REVOKED':
      return { ...base, status: 'revoked', autoRenew: false };
    case 'GRACE_PERIOD':
      return { ...base, status: 'grace_period' };
    case 'BILLING_RETRY':
      return { ...base, status: 'billing_retry' };
  }
}

/**
 * Development and test stand-in for the stores (BILLING_MODE=fake only). A purchase "receipt" is the
 * original transaction id and activates the subscription for one billing period from now.
 * Notifications are authenticated with an HMAC of the raw body (header X-Fake-Signature).
 */
@Injectable()
export class FakeBillingVerifier implements BillingVerifier {
  readonly provider = 'fake' as const;

  constructor(
    private readonly plans: PlansService,
    private readonly config: AppConfig,
  ) {}

  async verifyPurchase(productId: string, receipt: string): Promise<VerifiedSubscriptionState> {
    const plan = await this.plans.findPlanForProduct('fake', productId);
    if (!plan) {
      throw new AppException('INVALID_PURCHASE', 'Unknown product for this provider.');
    }
    const now = new Date();
    return {
      provider: 'fake',
      productId,
      originalTransactionId: receipt,
      latestTransactionId: `${receipt}:purchase:${now.getTime()}`,
      status: 'active',
      currentPeriodEnd: addBillingPeriod(now, plan.billingPeriod),
      autoRenew: true,
      cancelAtPeriodEnd: false,
      currency: null,
      grossAmountMinor: null,
      taxAmountMinor: null,
    };
  }

  parseNotification(rawBody: Buffer | undefined, headers: IncomingHttpHeaders): Promise<ParsedNotification> {
    const secret = this.config.get('FAKE_WEBHOOK_SECRET');
    if (!secret) {
      return Promise.reject(new AppException('PROVIDER_NOT_CONFIGURED'));
    }
    // Authenticity first: nothing is parsed or stored unless the signature matches.
    const signature = headers[FAKE_SIGNATURE_HEADER];
    if (!rawBody || !signaturesMatch(signFakeWebhookBody(secret, rawBody), signature)) {
      return Promise.reject(new AppException('INVALID_SIGNATURE'));
    }
    let json: unknown;
    try {
      json = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return Promise.reject(new AppException('VALIDATION_FAILED', 'Body must be JSON.'));
    }
    const parsed = fakeEventSchema.safeParse(json);
    if (!parsed.success) {
      const message = parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
      return Promise.reject(new AppException('VALIDATION_FAILED', message));
    }
    return Promise.resolve(mapFakeEvent(parsed.data));
  }
}
