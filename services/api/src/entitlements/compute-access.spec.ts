import type { StoredSubscriptionStatus } from '../database/schema';
import { computeAccess, tierSatisfies } from './compute-access';

const now = new Date('2026-11-12T00:00:00.000Z');
const before = new Date(now.getTime() + 60_000); // period still running
const after = new Date(now.getTime() - 60_000); // period already over

const ALL_STATUSES: StoredSubscriptionStatus[] = [
  'pending',
  'active',
  'grace_period',
  'billing_retry',
  'cancelled',
  'expired',
  'refunded',
  'revoked',
];

/** Expected access while the period end is still in the future. */
const GRANTS_INSIDE_PERIOD: Record<StoredSubscriptionStatus, boolean> = {
  pending: false,
  active: true,
  grace_period: true,
  billing_retry: false,
  cancelled: true,
  expired: false,
  refunded: false,
  revoked: false,
};

describe('computeAccess', () => {
  describe.each(ALL_STATUSES)('status %s', (status) => {
    it(`${GRANTS_INSIDE_PERIOD[status] ? 'grants' : 'denies'} access before the period end`, () => {
      const result = computeAccess({ status, currentPeriodEnd: before, planAccessTier: 'premium' }, now);
      expect(result).toEqual(
        GRANTS_INSIDE_PERIOD[status]
          ? { hasAccess: true, accessTier: 'premium' }
          : { hasAccess: false, accessTier: null },
      );
    });

    it('denies access after the period end', () => {
      expect(computeAccess({ status, currentPeriodEnd: after, planAccessTier: 'premium' }, now)).toEqual({
        hasAccess: false,
        accessTier: null,
      });
    });

    it('denies access exactly at the period end', () => {
      expect(computeAccess({ status, currentPeriodEnd: now, planAccessTier: 'premium' }, now)).toEqual({
        hasAccess: false,
        accessTier: null,
      });
    });

    it('denies access without a known period end', () => {
      expect(computeAccess({ status, currentPeriodEnd: null, planAccessTier: 'premium' }, now).hasAccess).toBe(false);
    });
  });

  it('denies access without any subscription', () => {
    expect(computeAccess(null, now)).toEqual({ hasAccess: false, accessTier: null });
  });

  it("reports the plan's access tier", () => {
    expect(computeAccess({ status: 'active', currentPeriodEnd: before, planAccessTier: 'free' }, now)).toEqual({
      hasAccess: true,
      accessTier: 'free',
    });
  });
});

describe('tierSatisfies', () => {
  it('lets anyone watch free content and only premium access watch premium content', () => {
    expect(tierSatisfies(null, 'free')).toBe(true);
    expect(tierSatisfies('free', 'free')).toBe(true);
    expect(tierSatisfies(null, 'premium')).toBe(false);
    expect(tierSatisfies('free', 'premium')).toBe(false);
    expect(tierSatisfies('premium', 'premium')).toBe(true);
  });
});
