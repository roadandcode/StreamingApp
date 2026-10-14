import type { AccessTier, StoredSubscriptionStatus } from '../database/schema';

export interface SubscriptionAccessInput {
  status: StoredSubscriptionStatus;
  /** End of the paid (or grace) period; `accessUntil` in the API. */
  currentPeriodEnd: Date | null;
  /** Access tier of the subscription's plan. */
  planAccessTier: AccessTier;
}

export interface AccessResult {
  hasAccess: boolean;
  accessTier: AccessTier | null;
}

/**
 * Statuses that grant access, and only while `currentPeriodEnd` is in the future:
 * - `active`: paid and renewing.
 * - `grace_period`: the store is retrying a failed renewal and offers grace; the period end is the
 *   grace expiry.
 * - `cancelled`: auto-renew is off but the paid period has not ended yet.
 *
 * `pending`, `billing_retry`, `expired`, `refunded` and `revoked` never grant access.
 */
const ACCESS_GRANTING_STATUSES: ReadonlySet<StoredSubscriptionStatus> = new Set([
  'active',
  'grace_period',
  'cancelled',
]);

const NO_ACCESS: AccessResult = { hasAccess: false, accessTier: null };

/** Pure: whether a subscription in this state grants access at `now`. */
export function computeAccess(subscription: SubscriptionAccessInput | null, now: Date): AccessResult {
  if (!subscription) return NO_ACCESS;
  if (!ACCESS_GRANTING_STATUSES.has(subscription.status)) return NO_ACCESS;
  if (!subscription.currentPeriodEnd) return NO_ACCESS;
  if (subscription.currentPeriodEnd.getTime() <= now.getTime()) return NO_ACCESS;
  return { hasAccess: true, accessTier: subscription.planAccessTier };
}

/** Whether an access tier satisfies content of `required` tier (premium covers free). */
export function tierSatisfies(granted: AccessTier | null, required: AccessTier): boolean {
  if (required === 'free') return true;
  return granted === 'premium';
}
