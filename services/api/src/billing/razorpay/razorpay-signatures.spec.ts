import { createHmac } from 'node:crypto';
import { signCheckout, signWebhook, verifyCheckoutSignature, verifyWebhookSignature } from './razorpay-signatures';

const KEY_SECRET = 'rzp-test-key-secret';
const WEBHOOK_SECRET = 'rzp-test-webhook-secret';

describe('Razorpay checkout signature', () => {
  const paymentId = 'pay_29QQoUBi66xm2f';
  const subscriptionId = 'sub_00000000000001';

  it('is the hex HMAC-SHA256 of "payment_id|subscription_id" with the key secret', () => {
    const expected = createHmac('sha256', KEY_SECRET).update(`${paymentId}|${subscriptionId}`).digest('hex');
    expect(signCheckout(KEY_SECRET, paymentId, subscriptionId)).toBe(expected);
  });

  it('accepts a valid signature', () => {
    const signature = signCheckout(KEY_SECRET, paymentId, subscriptionId);
    expect(verifyCheckoutSignature(KEY_SECRET, paymentId, subscriptionId, signature)).toBe(true);
    expect(verifyCheckoutSignature(KEY_SECRET, paymentId, subscriptionId, signature.toUpperCase())).toBe(true);
  });

  it('rejects tampered ids, signatures and secrets', () => {
    const signature = signCheckout(KEY_SECRET, paymentId, subscriptionId);
    expect(verifyCheckoutSignature(KEY_SECRET, 'pay_other', subscriptionId, signature)).toBe(false);
    expect(verifyCheckoutSignature(KEY_SECRET, paymentId, 'sub_other', signature)).toBe(false);
    expect(verifyCheckoutSignature(KEY_SECRET, subscriptionId, paymentId, signature)).toBe(false);
    expect(verifyCheckoutSignature('another-secret', paymentId, subscriptionId, signature)).toBe(false);
    const flipped = `${signature[0] === 'a' ? 'b' : 'a'}${signature.slice(1)}`;
    expect(verifyCheckoutSignature(KEY_SECRET, paymentId, subscriptionId, flipped)).toBe(false);
    expect(verifyCheckoutSignature(KEY_SECRET, paymentId, subscriptionId, '')).toBe(false);
    expect(verifyCheckoutSignature(KEY_SECRET, paymentId, subscriptionId, undefined)).toBe(false);
  });
});

describe('Razorpay webhook signature', () => {
  const body = Buffer.from('{"event":"subscription.charged","payload":{}}');

  it('accepts the HMAC of the exact raw body', () => {
    expect(verifyWebhookSignature(WEBHOOK_SECRET, body, signWebhook(WEBHOOK_SECRET, body))).toBe(true);
  });

  it('rejects a tampered body, a wrong secret or a missing signature', () => {
    const signature = signWebhook(WEBHOOK_SECRET, body);
    const reformatted = Buffer.from('{"event": "subscription.charged","payload":{}}');
    expect(verifyWebhookSignature(WEBHOOK_SECRET, reformatted, signature)).toBe(false);
    expect(verifyWebhookSignature(KEY_SECRET, body, signature)).toBe(false);
    expect(verifyWebhookSignature(WEBHOOK_SECRET, body, undefined)).toBe(false);
    expect(verifyWebhookSignature(WEBHOOK_SECRET, undefined, signature)).toBe(false);
  });
});
