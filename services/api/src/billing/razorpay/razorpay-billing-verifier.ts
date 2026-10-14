import type { IncomingHttpHeaders } from 'node:http';
import { Injectable } from '@nestjs/common';
import { AppException } from '../../common/errors';
import { AppConfig } from '../../config/app-config';
import { isRazorpayConfigured } from '../../config/env.schema';
import type { BillingVerifier, ParsedNotification, VerifiedSubscriptionState } from '../billing-verifier';
import { mapRazorpayEvent } from './razorpay-events';
import { verifyWebhookSignature } from './razorpay-signatures';

export const RAZORPAY_SIGNATURE_HEADER = 'x-razorpay-signature';
export const RAZORPAY_EVENT_ID_HEADER = 'x-razorpay-event-id';

function header(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Razorpay (web) in the billing seam. Purchases go through the checkout endpoints, not
 * `POST /v1/purchases/verify`; webhooks are authenticated with X-Razorpay-Signature.
 * Without the Razorpay credentials everything fails closed with `503 PROVIDER_NOT_CONFIGURED`.
 */
@Injectable()
export class RazorpayBillingVerifier implements BillingVerifier {
  readonly provider = 'razorpay' as const;

  constructor(private readonly config: AppConfig) {}

  verifyPurchase(): Promise<VerifiedSubscriptionState> {
    return Promise.reject(
      new AppException('INVALID_PURCHASE', 'Razorpay purchases are verified through the web checkout endpoints.'),
    );
  }

  parseNotification(rawBody: Buffer | undefined, headers: IncomingHttpHeaders): Promise<ParsedNotification> {
    const configured = isRazorpayConfigured({
      RAZORPAY_KEY_ID: this.config.get('RAZORPAY_KEY_ID'),
      RAZORPAY_KEY_SECRET: this.config.get('RAZORPAY_KEY_SECRET'),
      RAZORPAY_WEBHOOK_SECRET: this.config.get('RAZORPAY_WEBHOOK_SECRET'),
    });
    const secret = this.config.get('RAZORPAY_WEBHOOK_SECRET');
    if (!configured || !secret) {
      return Promise.reject(new AppException('PROVIDER_NOT_CONFIGURED'));
    }
    if (!verifyWebhookSignature(secret, rawBody, header(headers, RAZORPAY_SIGNATURE_HEADER))) {
      return Promise.reject(new AppException('INVALID_SIGNATURE'));
    }
    const eventId = header(headers, RAZORPAY_EVENT_ID_HEADER)?.trim();
    if (!eventId || eventId.length > 200) {
      return Promise.reject(new AppException('VALIDATION_FAILED', 'X-Razorpay-Event-Id header is required.'));
    }
    let json: unknown;
    try {
      json = JSON.parse((rawBody ?? Buffer.alloc(0)).toString('utf8'));
    } catch {
      return Promise.reject(new AppException('VALIDATION_FAILED', 'Body must be JSON.'));
    }
    const result = mapRazorpayEvent(eventId, json);
    if (!result.ok) {
      return Promise.reject(new AppException('VALIDATION_FAILED', result.message));
    }
    return Promise.resolve(result.notification);
  }
}
