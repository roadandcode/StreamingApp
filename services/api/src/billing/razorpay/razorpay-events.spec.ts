import { mapRazorpayEvent, mapRazorpaySubscriptionStatus, RAZORPAY_EVENT_STATUS } from './razorpay-events';

const currentEnd = 1_800_000_000; // 2027-01-15T08:00:00Z
const createdAt = 1_790_000_000;

function subscriptionEvent(event: string, extra: Record<string, unknown> = {}) {
  return {
    entity: 'event',
    account_id: 'acc_test',
    event,
    contains: ['subscription'],
    created_at: createdAt,
    payload: {
      subscription: {
        entity: { id: 'sub_123', entity: 'subscription', plan_id: 'plan_m', status: 'active', current_start: 1, current_end: currentEnd },
      },
      ...extra,
    },
  };
}

describe('Razorpay event mapping', () => {
  it.each([
    ['subscription.authenticated', 'pending'],
    ['subscription.activated', 'active'],
    ['subscription.charged', 'active'],
    ['subscription.pending', 'billing_retry'],
    ['subscription.halted', 'expired'],
    ['subscription.cancelled', 'cancelled'],
    ['subscription.completed', 'expired'],
  ])('maps %s to %s', (event, status) => {
    const result = mapRazorpayEvent('evt_1', subscriptionEvent(event));
    expect(result).toMatchObject({
      ok: true,
      notification: {
        kind: 'subscription',
        eventId: 'evt_1',
        originalTransactionId: 'sub_123',
        status,
        currentPeriodEnd: new Date(currentEnd * 1000),
        occurredAt: new Date(createdAt * 1000),
      },
    });
    expect(RAZORPAY_EVENT_STATUS[event]).toBe(status);
  });

  it('records the payment of a charge as a billing transaction', () => {
    const result = mapRazorpayEvent(
      'evt_2',
      subscriptionEvent('subscription.charged', {
        payment: { entity: { id: 'pay_1', amount: 19900, currency: 'inr', status: 'captured' } },
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      notification: {
        autoRenew: true,
        cancelAtPeriodEnd: false,
        charge: { transactionId: 'pay_1', currency: 'INR', grossAmountMinor: 19900, taxAmountMinor: null },
      },
    });
  });

  it('keeps access for cancellations until current_end and stops renewal', () => {
    const result = mapRazorpayEvent('evt_3', subscriptionEvent('subscription.cancelled'));
    expect(result).toMatchObject({
      ok: true,
      notification: { status: 'cancelled', autoRenew: false, cancelAtPeriodEnd: true, charge: null },
    });
  });

  it('maps refund.processed to the refunded payment', () => {
    const result = mapRazorpayEvent('evt_4', {
      event: 'refund.processed',
      created_at: createdAt,
      payload: {
        refund: { entity: { id: 'rfnd_1', payment_id: 'pay_1', amount: 19900 } },
        payment: { entity: { id: 'pay_1', amount: 19900, currency: 'INR' } },
      },
    });
    expect(result).toEqual({
      ok: true,
      notification: { kind: 'refund', eventId: 'evt_4', occurredAt: new Date(createdAt * 1000), refundedTransactionId: 'pay_1' },
    });
  });

  it('ignores events it does not use', () => {
    expect(mapRazorpayEvent('evt_5', { event: 'payment.captured', payload: {} })).toMatchObject({
      ok: true,
      notification: { kind: 'ignored' },
    });
  });

  it('rejects bodies without the entity the event needs', () => {
    expect(mapRazorpayEvent('evt_6', { event: 'subscription.charged', payload: {} })).toMatchObject({ ok: false });
    expect(mapRazorpayEvent('evt_7', { event: 'refund.processed', payload: {} })).toMatchObject({ ok: false });
    expect(mapRazorpayEvent('evt_8', { payload: {} })).toMatchObject({ ok: false });
    expect(mapRazorpayEvent('evt_9', 'not an object')).toMatchObject({ ok: false });
  });
});

describe('Razorpay subscription entity status', () => {
  it.each([
    ['created', 'pending'],
    ['authenticated', 'pending'],
    ['active', 'active'],
    ['pending', 'billing_retry'],
    ['halted', 'expired'],
    ['cancelled', 'cancelled'],
    ['completed', 'expired'],
    ['expired', 'expired'],
    ['paused', 'cancelled'],
    ['something-new', 'pending'],
  ])('maps %s to %s', (status, expected) => {
    expect(mapRazorpaySubscriptionStatus(status)).toBe(expected);
  });
});
