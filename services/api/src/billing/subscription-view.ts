import type { AccessTier, BillingProvider, StoredSubscriptionStatus } from '../database/schema';
import { computeAccess } from '../entitlements/compute-access';
import type { SubscriptionViewDto } from './billing.dto';

export interface SubscriptionViewInput {
  status: StoredSubscriptionStatus;
  currentPeriodEnd: Date | null;
  autoRenew: boolean;
  provider: BillingProvider;
  planCode: string;
  planAccessTier: AccessTier;
  updatedAt: Date;
}

export const NO_SUBSCRIPTION_VIEW: SubscriptionViewDto = {
  status: 'none',
  hasAccess: false,
  accessTier: null,
  planCode: null,
  provider: null,
  accessUntil: null,
  autoRenewEnabled: false,
};

/**
 * Pure: the subscription a user sees. Prefers a subscription that grants access (highest tier, then
 * latest period end); otherwise the most recently updated one; `status: "none"` if there is none.
 */
export function buildSubscriptionView(subscriptions: SubscriptionViewInput[], now: Date): SubscriptionViewDto {
  if (subscriptions.length === 0) return NO_SUBSCRIPTION_VIEW;
  const withAccess = subscriptions.map((s) => ({ s, access: computeAccess(s, now) }));
  const granting = withAccess
    .filter((entry) => entry.access.hasAccess)
    .sort((a, b) => {
      const tier = Number(b.s.planAccessTier === 'premium') - Number(a.s.planAccessTier === 'premium');
      if (tier !== 0) return tier;
      return (b.s.currentPeriodEnd?.getTime() ?? 0) - (a.s.currentPeriodEnd?.getTime() ?? 0);
    });
  const chosen =
    granting[0] ?? [...withAccess].sort((a, b) => b.s.updatedAt.getTime() - a.s.updatedAt.getTime())[0];
  if (!chosen) return NO_SUBSCRIPTION_VIEW;
  return {
    status: chosen.s.status,
    hasAccess: chosen.access.hasAccess,
    accessTier: chosen.access.accessTier,
    planCode: chosen.s.planCode,
    provider: chosen.s.provider,
    accessUntil: chosen.s.currentPeriodEnd?.toISOString() ?? null,
    autoRenewEnabled: chosen.s.autoRenew,
  };
}
