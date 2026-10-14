import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { AppException } from '../common/errors';
import { type Database, DRIZZLE, type Executor } from '../database/database.types';
import { type BillingProvider, billingTransactions, plans, subscriptions } from '../database/schema';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { revokePlaybackSessions } from '../playback/session-revocation';
import type { ApplyOutcome } from '../webhooks/provider-event-dedupe';
import type { SubscriptionViewDto, VerifyPurchaseDto } from './billing.dto';
import { addBillingPeriod } from './billing-period';
import { BILLING_VERIFIER_LIST, type BillingVerifier, type ParsedNotification } from './billing-verifier';
import { PlansService } from './plans.service';
import { buildSubscriptionView, NO_SUBSCRIPTION_VIEW, type SubscriptionViewInput } from './subscription-view';

/** Revocation reason stored on playback sessions when the user loses premium access. */
export const ENTITLEMENT_LOST_REASON = 'ENTITLEMENT_REQUIRED';

@Injectable()
export class BillingService {
  private readonly verifiers: Map<BillingProvider, BillingVerifier>;

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(BILLING_VERIFIER_LIST) verifiers: BillingVerifier[],
    private readonly plans: PlansService,
    private readonly entitlements: EntitlementsService,
  ) {
    this.verifiers = new Map(verifiers.map((v) => [v.provider, v]));
  }

  /** The verifier for a provider. `fake` exists only in fake billing mode. */
  verifier(provider: BillingProvider): BillingVerifier {
    const verifier = this.verifiers.get(provider);
    if (!verifier) {
      throw new AppException('INVALID_PURCHASE', 'This billing provider is not available.');
    }
    return verifier;
  }

  async getView(userId: string, now = new Date()): Promise<SubscriptionViewDto> {
    const views = await this.getViews(this.db, [userId], now);
    return views.get(userId) ?? NO_SUBSCRIPTION_VIEW;
  }

  /** Subscription views for many users in one query (admin lists). */
  async getViews(executor: Executor, userIds: string[], now = new Date()): Promise<Map<string, SubscriptionViewDto>> {
    const result = new Map<string, SubscriptionViewDto>();
    if (userIds.length === 0) return result;
    const rows = await executor
      .select({
        userId: subscriptions.userId,
        status: subscriptions.status,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
        autoRenew: subscriptions.autoRenew,
        provider: subscriptions.provider,
        updatedAt: subscriptions.updatedAt,
        planCode: plans.code,
        planAccessTier: plans.accessTier,
      })
      .from(subscriptions)
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .where(inArray(subscriptions.userId, userIds));
    const grouped = new Map<string, SubscriptionViewInput[]>();
    for (const row of rows) {
      grouped.set(row.userId, [...(grouped.get(row.userId) ?? []), row]);
    }
    for (const userId of userIds) {
      result.set(userId, buildSubscriptionView(grouped.get(userId) ?? [], now));
    }
    return result;
  }

  /**
   * Verifies a purchase proof with the provider and applies the verified state in one transaction:
   * subscription upsert, billing transaction, entitlement recompute.
   */
  async verifyPurchase(userId: string, dto: VerifyPurchaseDto): Promise<SubscriptionViewDto> {
    const state = await this.verifier(dto.provider).verifyPurchase(dto.productId, dto.receipt);
    const now = new Date();
    await this.db.transaction(async (tx) => {
      const plan = await this.plans.findPlanForProduct(state.provider, state.productId, tx);
      if (!plan) {
        throw new AppException('INVALID_PURCHASE', 'Unknown product for this provider.');
      }
      const values = {
        planId: plan.id,
        status: state.status,
        currentPeriodEnd: state.currentPeriodEnd,
        autoRenew: state.autoRenew,
        cancelAtPeriodEnd: state.cancelAtPeriodEnd,
        lastVerifiedAt: now,
      };
      const [inserted] = await tx
        .insert(subscriptions)
        .values({ ...values, userId, provider: state.provider, providerSubscriptionId: state.originalTransactionId })
        .onConflictDoNothing({ target: [subscriptions.provider, subscriptions.providerSubscriptionId] })
        .returning({ id: subscriptions.id });
      let subscriptionId = inserted?.id;
      if (!subscriptionId) {
        const [existing] = await tx
          .select({ id: subscriptions.id, userId: subscriptions.userId })
          .from(subscriptions)
          .where(
            and(
              eq(subscriptions.provider, state.provider),
              eq(subscriptions.providerSubscriptionId, state.originalTransactionId),
            ),
          )
          .for('update')
          .limit(1);
        if (!existing) throw new Error('Subscription vanished during verification');
        if (existing.userId !== userId) {
          throw new AppException('PURCHASE_BELONGS_TO_OTHER_ACCOUNT');
        }
        await tx.update(subscriptions).set(values).where(eq(subscriptions.id, existing.id));
        subscriptionId = existing.id;
      }
      if (state.latestTransactionId) {
        await tx
          .insert(billingTransactions)
          .values({
            subscriptionId,
            provider: state.provider,
            providerTransactionId: state.latestTransactionId,
            originalTransactionId: state.originalTransactionId,
            currency: state.currency,
            grossAmountMinor: state.grossAmountMinor,
            taxAmountMinor: state.taxAmountMinor,
          })
          .onConflictDoNothing({ target: [billingTransactions.provider, billingTransactions.providerTransactionId] });
      }
      await this.recomputeAccess(tx, userId, now);
    });
    return this.getView(userId, now);
  }

  /**
   * Applies a verified store notification inside the caller's transaction (see the webhook dedupe).
   * Unknown subscriptions and events older than the stored state are skipped.
   */
  async applyNotification(
    tx: Executor,
    provider: BillingProvider,
    event: ParsedNotification,
    now: Date,
  ): Promise<ApplyOutcome> {
    const [current] = await tx
      .select({ subscription: subscriptions, billingPeriod: plans.billingPeriod })
      .from(subscriptions)
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .where(and(eq(subscriptions.provider, provider), eq(subscriptions.providerSubscriptionId, event.originalTransactionId)))
      .for('update', { of: subscriptions })
      .limit(1);
    if (!current) {
      // The app has not verified this purchase yet; verification will fetch the current state.
      return { status: 'skipped', note: 'unknown subscription' };
    }
    const sub = current.subscription;
    if (event.occurredAt && sub.lastVerifiedAt && event.occurredAt.getTime() < sub.lastVerifiedAt.getTime()) {
      return { status: 'skipped', note: 'older than the stored state' };
    }

    let currentPeriodEnd = event.currentPeriodEnd ?? sub.currentPeriodEnd;
    if (!event.currentPeriodEnd && event.extendOnePeriod) {
      const from = sub.currentPeriodEnd && sub.currentPeriodEnd.getTime() > now.getTime() ? sub.currentPeriodEnd : now;
      currentPeriodEnd = addBillingPeriod(from, current.billingPeriod);
    }
    await tx
      .update(subscriptions)
      .set({
        status: event.status,
        currentPeriodEnd,
        autoRenew: event.autoRenew ?? sub.autoRenew,
        cancelAtPeriodEnd: event.cancelAtPeriodEnd ?? sub.cancelAtPeriodEnd,
        lastVerifiedAt: event.occurredAt ?? now,
      })
      .where(eq(subscriptions.id, sub.id));

    if (event.transactionId) {
      await tx
        .insert(billingTransactions)
        .values({
          subscriptionId: sub.id,
          provider,
          providerTransactionId: event.transactionId,
          originalTransactionId: event.originalTransactionId,
        })
        .onConflictDoNothing({ target: [billingTransactions.provider, billingTransactions.providerTransactionId] });
    }
    if (event.refunded) {
      const [latest] = await tx
        .select({ id: billingTransactions.id })
        .from(billingTransactions)
        .where(eq(billingTransactions.subscriptionId, sub.id))
        .orderBy(desc(billingTransactions.createdAt))
        .limit(1);
      if (latest) {
        await tx.update(billingTransactions).set({ refundStatus: 'refunded' }).where(eq(billingTransactions.id, latest.id));
      }
    }
    await this.recomputeAccess(tx, sub.userId, now);
    return { status: 'processed' };
  }

  /** Recomputes the entitlement; when premium access is lost, open premium playback is revoked. */
  private async recomputeAccess(tx: Executor, userId: string, now: Date): Promise<void> {
    const { hadAccess, hasAccess } = await this.entitlements.recomputeForUser(tx, userId, now);
    if (hadAccess && !hasAccess) {
      await revokePlaybackSessions(tx, { userId, premiumOnly: true }, ENTITLEMENT_LOST_REASON, now);
    }
  }
}
