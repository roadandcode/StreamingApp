import { z } from 'zod';
import type { StoredSubscriptionStatus } from '../../database/schema';
import type { ParsedNotification, ProviderCharge, SubscriptionNotification } from '../billing-verifier';
import type { RazorpaySubscription } from './razorpay-client';

/** Webhook event → subscription status (docs/architecture/api-contract.md, Razorpay event mapping). */
export const RAZORPAY_EVENT_STATUS: Readonly<Record<string, StoredSubscriptionStatus>> = {
  'subscription.authenticated': 'pending',
  'subscription.activated': 'active',
  'subscription.charged': 'active',
  'subscription.pending': 'billing_retry',
  'subscription.halted': 'expired',
  'subscription.cancelled': 'cancelled',
  'subscription.completed': 'expired',
};

/** Status of a subscription entity fetched from the API (the verify fast path). */
const ENTITY_STATUS: Readonly<Record<string, StoredSubscriptionStatus>> = {
  created: 'pending',
  authenticated: 'pending',
  active: 'active',
  pending: 'billing_retry',
  halted: 'expired',
  cancelled: 'cancelled',
  completed: 'expired',
  expired: 'expired',
  // A paused subscription stops renewing; the paid period still runs out.
  paused: 'cancelled',
};

export function mapRazorpaySubscriptionStatus(status: string): StoredSubscriptionStatus {
  return ENTITY_STATUS[status] ?? 'pending';
}

const NOT_RENEWING: ReadonlySet<StoredSubscriptionStatus> = new Set(['cancelled', 'expired', 'refunded', 'revoked']);

export interface RazorpaySubscriptionState {
  status: StoredSubscriptionStatus;
  currentPeriodEnd: Date | undefined;
  autoRenew: boolean | undefined;
  cancelAtPeriodEnd: boolean | undefined;
}

const fromUnix = (seconds: number | null | undefined): Date | undefined =>
  typeof seconds === 'number' && seconds > 0 ? new Date(seconds * 1000) : undefined;

/** Normalized state from a subscription entity and the status it maps to. */
export function subscriptionState(entity: RazorpaySubscription, status: StoredSubscriptionStatus): RazorpaySubscriptionState {
  return {
    status,
    currentPeriodEnd: fromUnix(entity.current_end),
    autoRenew: status === 'active' ? true : NOT_RENEWING.has(status) ? false : undefined,
    cancelAtPeriodEnd: status === 'cancelled' ? true : status === 'active' ? false : undefined,
  };
}

const subscriptionEntity = z.looseObject({
  id: z.string().min(1).max(100),
  plan_id: z.string().min(1).max(100),
  status: z.string().max(50),
  current_start: z.number().nullish(),
  current_end: z.number().nullish(),
});

const paymentEntity = z.looseObject({
  id: z.string().min(1).max(100),
  amount: z.number().int().nonnegative().nullish(),
  currency: z.string().length(3).nullish(),
});

const refundEntity = z.looseObject({
  id: z.string().min(1).max(100),
  payment_id: z.string().min(1).max(100),
});

const webhookBody = z.looseObject({
  event: z.string().min(1).max(100),
  created_at: z.number().int().positive().nullish(),
  payload: z
    .looseObject({
      subscription: z.looseObject({ entity: subscriptionEntity }).optional(),
      payment: z.looseObject({ entity: paymentEntity }).optional(),
      refund: z.looseObject({ entity: refundEntity }).optional(),
    })
    .default({}),
});

export type RazorpayWebhookBody = z.input<typeof webhookBody>;

export type RazorpayEventParseResult = { ok: true; notification: ParsedNotification } | { ok: false; message: string };

/** Pure: maps a verified Razorpay webhook body to a normalized notification. */
export function mapRazorpayEvent(eventId: string, body: unknown): RazorpayEventParseResult {
  const parsed = webhookBody.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '),
    };
  }
  const { event, payload } = parsed.data;
  const occurredAt = fromUnix(parsed.data.created_at) ?? null;
  const base = { eventId, occurredAt };

  if (event === 'refund.processed') {
    const refund = payload.refund?.entity;
    if (!refund) return { ok: false, message: 'payload.refund.entity is required' };
    return { ok: true, notification: { ...base, kind: 'refund', refundedTransactionId: refund.payment_id } };
  }

  const status = RAZORPAY_EVENT_STATUS[event];
  if (!status) {
    return { ok: true, notification: { ...base, kind: 'ignored', reason: `event ${event} is not used` } };
  }
  const subscription = payload.subscription?.entity;
  if (!subscription) {
    return { ok: false, message: 'payload.subscription.entity is required' };
  }
  const payment = payload.payment?.entity;
  const charge: ProviderCharge | null =
    payment && status === 'active'
      ? {
          transactionId: payment.id,
          currency: payment.currency?.toUpperCase() ?? null,
          grossAmountMinor: payment.amount ?? null,
          taxAmountMinor: null,
        }
      : null;
  const state = subscriptionState(subscription, status);
  const notification: SubscriptionNotification = {
    ...base,
    kind: 'subscription',
    originalTransactionId: subscription.id,
    status,
    charge,
    currentPeriodEnd: state.currentPeriodEnd,
    autoRenew: state.autoRenew,
    cancelAtPeriodEnd: state.cancelAtPeriodEnd,
  };
  return { ok: true, notification };
}
