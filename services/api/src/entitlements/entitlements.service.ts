import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Executor } from '../database/database.types';
import { type EntitlementRow, entitlements, plans, subscriptions } from '../database/schema';
import { type AccessResult, computeAccess } from './compute-access';

export interface RecomputeResult {
  hadAccess: boolean;
  hasAccess: boolean;
}

function rowGrantsAccess(row: EntitlementRow | undefined, now: Date): boolean {
  return (
    !!row &&
    !row.revokedAt &&
    row.validFrom.getTime() <= now.getTime() &&
    row.validUntil.getTime() > now.getTime()
  );
}

/**
 * Keeps one normalized entitlement per user, derived from all of their subscriptions with
 * `computeAccess`. Playback checks read this row; it is recomputed inside the same transaction as
 * every subscription change.
 */
@Injectable()
export class EntitlementsService {
  async getAccess(db: Executor, userId: string, now: Date): Promise<AccessResult> {
    const [row] = await db.select().from(entitlements).where(eq(entitlements.userId, userId)).limit(1);
    if (!row || !rowGrantsAccess(row, now)) {
      return { hasAccess: false, accessTier: null };
    }
    return { hasAccess: true, accessTier: row.accessTier };
  }

  async recomputeForUser(db: Executor, userId: string, now: Date): Promise<RecomputeResult> {
    const [existing] = await db
      .select()
      .from(entitlements)
      .where(eq(entitlements.userId, userId))
      .for('update')
      .limit(1);
    const hadAccess = rowGrantsAccess(existing, now);

    const candidates = await db
      .select({
        id: subscriptions.id,
        planId: subscriptions.planId,
        status: subscriptions.status,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
        planAccessTier: plans.accessTier,
      })
      .from(subscriptions)
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .where(eq(subscriptions.userId, userId));

    // The granting subscription with the highest tier, then the latest period end.
    const granting = candidates
      .filter((s) => computeAccess(s, now).hasAccess)
      .sort((a, b) => {
        const tier = Number(b.planAccessTier === 'premium') - Number(a.planAccessTier === 'premium');
        if (tier !== 0) return tier;
        return (b.currentPeriodEnd?.getTime() ?? 0) - (a.currentPeriodEnd?.getTime() ?? 0);
      })[0];

    if (granting?.currentPeriodEnd) {
      const values = {
        planId: granting.planId,
        accessTier: granting.planAccessTier,
        validUntil: granting.currentPeriodEnd,
        sourceSubscriptionId: granting.id,
        revokedAt: null,
      };
      if (existing) {
        await db
          .update(entitlements)
          .set({ ...values, validFrom: hadAccess ? existing.validFrom : now })
          .where(eq(entitlements.id, existing.id));
      } else {
        await db.insert(entitlements).values({ ...values, userId, validFrom: now });
      }
      return { hadAccess, hasAccess: true };
    }

    if (existing && !existing.revokedAt) {
      await db.update(entitlements).set({ revokedAt: now }).where(eq(entitlements.id, existing.id));
    }
    return { hadAccess, hasAccess: false };
  }
}
