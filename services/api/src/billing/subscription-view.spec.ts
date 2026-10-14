import { buildSubscriptionView, NO_SUBSCRIPTION_VIEW, type SubscriptionViewInput } from './subscription-view';

const now = new Date('2026-11-12T00:00:00.000Z');
const days = (n: number) => new Date(now.getTime() + n * 86_400_000);

function sub(overrides: Partial<SubscriptionViewInput>): SubscriptionViewInput {
  return {
    status: 'active',
    currentPeriodEnd: days(30),
    autoRenew: true,
    provider: 'fake',
    planCode: 'premium_monthly',
    planAccessTier: 'premium',
    updatedAt: now,
    ...overrides,
  };
}

describe('buildSubscriptionView', () => {
  it('returns status none without subscriptions', () => {
    expect(buildSubscriptionView([], now)).toEqual(NO_SUBSCRIPTION_VIEW);
  });

  it('maps an active subscription', () => {
    expect(buildSubscriptionView([sub({})], now)).toEqual({
      status: 'active',
      hasAccess: true,
      accessTier: 'premium',
      planCode: 'premium_monthly',
      provider: 'fake',
      accessUntil: days(30).toISOString(),
      autoRenewEnabled: true,
    });
  });

  it('keeps access for a cancelled subscription until the period ends', () => {
    const view = buildSubscriptionView([sub({ status: 'cancelled', autoRenew: false })], now);
    expect(view).toMatchObject({ status: 'cancelled', hasAccess: true, autoRenewEnabled: false });
  });

  it('shows the latest subscription without access when nothing grants access', () => {
    const view = buildSubscriptionView(
      [
        sub({ status: 'expired', currentPeriodEnd: days(-60), updatedAt: days(-60), planCode: 'premium_yearly' }),
        sub({ status: 'billing_retry', currentPeriodEnd: days(3), updatedAt: days(-1) }),
      ],
      now,
    );
    expect(view).toMatchObject({ status: 'billing_retry', hasAccess: false, accessTier: null, planCode: 'premium_monthly' });
  });

  it('prefers a granting subscription over a more recent one without access', () => {
    const view = buildSubscriptionView(
      [
        sub({ status: 'revoked', updatedAt: days(0), provider: 'google' }),
        sub({ status: 'active', updatedAt: days(-10), provider: 'apple', currentPeriodEnd: days(5) }),
      ],
      now,
    );
    expect(view).toMatchObject({ status: 'active', provider: 'apple', hasAccess: true });
  });
});
