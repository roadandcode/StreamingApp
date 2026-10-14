import { createHmac } from 'node:crypto';
import { signaturesMatch } from '../../common/signatures';

/**
 * Checkout handler signature: hex HMAC-SHA256 with the key secret over
 * `razorpay_payment_id + "|" + razorpay_subscription_id`.
 */
export function signCheckout(keySecret: string, paymentId: string, subscriptionId: string): string {
  return createHmac('sha256', keySecret).update(`${paymentId}|${subscriptionId}`, 'utf8').digest('hex');
}

export function verifyCheckoutSignature(
  keySecret: string,
  paymentId: string,
  subscriptionId: string,
  signature: unknown,
): boolean {
  return signaturesMatch(signCheckout(keySecret, paymentId, subscriptionId), signature);
}

/** Webhook signature (`X-Razorpay-Signature`): hex HMAC-SHA256 of the raw body with the webhook secret. */
export function signWebhook(webhookSecret: string, rawBody: Buffer | string): string {
  return createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
}

export function verifyWebhookSignature(webhookSecret: string, rawBody: Buffer | undefined, signature: unknown): boolean {
  if (!rawBody) return false;
  return signaturesMatch(signWebhook(webhookSecret, rawBody), signature);
}
