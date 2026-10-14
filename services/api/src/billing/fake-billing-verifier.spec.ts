import type { AppConfig } from '../config/app-config';
import type { PlanRow } from '../database/schema';
import { FakeBillingVerifier, mapFakeEvent, signFakeWebhookBody } from './fake-billing-verifier';
import type { PlansService } from './plans.service';

const SECRET = 'fake-webhook-secret-for-tests';

function verifier(plan: Partial<PlanRow> | null = { billingPeriod: 'P1M', accessTier: 'premium' }): FakeBillingVerifier {
  const plans = { findPlanForProduct: jest.fn(() => Promise.resolve(plan)) } as unknown as PlansService;
  const config = { get: (key: string) => (key === 'FAKE_WEBHOOK_SECRET' ? SECRET : undefined) } as unknown as AppConfig;
  return new FakeBillingVerifier(plans, config);
}

describe('FakeBillingVerifier.verifyPurchase', () => {
  it('activates the receipt as the original transaction for one billing period', async () => {
    const before = Date.now();
    const state = await verifier().verifyPurchase('fake_premium_monthly', 'txn-1');
    expect(state).toMatchObject({
      provider: 'fake',
      productId: 'fake_premium_monthly',
      originalTransactionId: 'txn-1',
      status: 'active',
      autoRenew: true,
    });
    const days = ((state.currentPeriodEnd?.getTime() ?? 0) - before) / 86_400_000;
    expect(days).toBeGreaterThanOrEqual(28);
    expect(days).toBeLessThanOrEqual(31.01);
  });

  it('rejects unknown products with INVALID_PURCHASE', async () => {
    await expect(verifier(null).verifyPurchase('nope', 'txn-1')).rejects.toMatchObject({ code: 'INVALID_PURCHASE' });
  });
});

describe('FakeBillingVerifier.parseNotification', () => {
  const body = Buffer.from(JSON.stringify({ eventId: 'evt-1', type: 'EXPIRED', originalTransactionId: 'txn-1' }));

  it('accepts a correctly signed body', async () => {
    const parsed = await verifier().parseNotification(body, { 'x-fake-signature': signFakeWebhookBody(SECRET, body) });
    expect(parsed).toMatchObject({ eventId: 'evt-1', originalTransactionId: 'txn-1', status: 'expired' });
  });

  it('rejects a missing, wrong or foreign signature before parsing', async () => {
    const v = verifier();
    await expect(v.parseNotification(body, {})).rejects.toMatchObject({ code: 'INVALID_SIGNATURE' });
    await expect(v.parseNotification(body, { 'x-fake-signature': 'deadbeef' })).rejects.toMatchObject({
      code: 'INVALID_SIGNATURE',
    });
    await expect(
      v.parseNotification(body, { 'x-fake-signature': signFakeWebhookBody('another-secret-value', body) }),
    ).rejects.toMatchObject({ code: 'INVALID_SIGNATURE' });
    const tampered = Buffer.from(body.toString().replace('EXPIRED', 'RENEWED'));
    await expect(
      v.parseNotification(tampered, { 'x-fake-signature': signFakeWebhookBody(SECRET, body) }),
    ).rejects.toMatchObject({ code: 'INVALID_SIGNATURE' });
    await expect(v.parseNotification(undefined, { 'x-fake-signature': 'x' })).rejects.toMatchObject({
      code: 'INVALID_SIGNATURE',
    });
  });

  it('rejects signed bodies that are not valid events', async () => {
    const bad = Buffer.from(JSON.stringify({ eventId: 'evt-2', type: 'UPGRADED', originalTransactionId: 'txn-1' }));
    await expect(
      verifier().parseNotification(bad, { 'x-fake-signature': signFakeWebhookBody(SECRET, bad) }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('mapFakeEvent', () => {
  const base = { eventId: 'e', originalTransactionId: 't' };

  it('maps every event type to a stored status', () => {
    expect(mapFakeEvent({ ...base, type: 'RENEWED' })).toMatchObject({ status: 'active', extendOnePeriod: true });
    expect(mapFakeEvent({ ...base, type: 'CANCELLED' })).toMatchObject({ status: 'cancelled', autoRenew: false });
    expect(mapFakeEvent({ ...base, type: 'EXPIRED' })).toMatchObject({ status: 'expired' });
    expect(mapFakeEvent({ ...base, type: 'REFUNDED' })).toMatchObject({ status: 'refunded', refunded: true });
    expect(mapFakeEvent({ ...base, type: 'REVOKED' })).toMatchObject({ status: 'revoked' });
    expect(mapFakeEvent({ ...base, type: 'GRACE_PERIOD' })).toMatchObject({ status: 'grace_period' });
    expect(mapFakeEvent({ ...base, type: 'BILLING_RETRY' })).toMatchObject({ status: 'billing_retry' });
  });

  it('uses expiresAt as the new period end', () => {
    const mapped = mapFakeEvent({ ...base, type: 'RENEWED', expiresAt: '2027-01-01T00:00:00Z' });
    expect(mapped.currentPeriodEnd?.toISOString()).toBe('2027-01-01T00:00:00.000Z');
    expect(mapped.extendOnePeriod).toBe(false);
  });
});
