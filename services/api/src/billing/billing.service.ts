import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { AppException } from '../common/errors';
import { type Database, DRIZZLE, type Executor } from '../database/database.types';
import {
  type BillingPeriod,
  type BillingProvider,
  billingTransactions,
  plans,
  type StoredSubscriptionStatus,
  type SubscriptionRow,
  subscriptions,
} from '../database/schema';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { revokePlaybackSessions } from '../playback/session-revocation';
import type { ApplyOutcome } from '../webhooks/provider-event-dedupe';
import type { SubscriptionViewDto, VerifyPurchaseDto } from './billing.dto';
import { addBillingPeriod } from './billing-period';
import {
  BILLING_VERIFIER_LIST,
  type BillingVerifier,
  type ParsedNotification,
  type ProviderCharge,
  type RefundNotification,
  type SubscriptionNotification,
} from './billing-verifier';
import { PlansService } from './plans.service';
import { buildSubscriptionView, NO_SUBSCRIPTION_VIEW, type SubscriptionViewInput } from './subscription-view';

/** Fields of a provider state change; `undefined` keeps the stored value. */
export interface SubscriptionStateUpdate {
  status: StoredSubscriptionStatus;
  currentPeriodEnd?: Date | null;
  autoRenew?: boolean;
  cancelAtPeriodEnd?: boolean;
  planId?: string;
  /** Stored as last_verified_at: when this state was read from (or reported by) the provider. */
  verifiedAt: Date;
}

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
    switch (event.kind) {
      case 'ignored':
        return { status: 'skipped', note: event.reason };
      case 'refund':
        return this.applyRefund(tx, provider, event, now);
      case 'subscription':
        return this.applySubscriptionEvent(tx, provider, event, now);
    }
  }

  /** Locks and returns a subscription by provider id, with its plan's billing period. */
  async lockSubscription(
    tx: Executor,
    provider: BillingProvider,
    providerSubscriptionId: string,
  ): Promise<{ subscription: SubscriptionRow; billingPeriod: BillingPeriod } | null> {
    const [row] = await tx
      .select({ subscription: subscriptions, billingPeriod: plans.billingPeriod })
      .from(subscriptions)
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .where(and(eq(subscriptions.provider, provider), eq(subscriptions.providerSubscriptionId, providerSubscriptionId)))
      .for('update', { of: subscriptions })
      .limit(1);
    return row ?? null;
  }

  /**
   * Writes provider state onto a locked subscription, records the charge (if any) and recomputes the
   * user's entitlement, all in the caller's transaction.
   */
  async applyState(
    tx: Executor,
    sub: SubscriptionRow,
    update: SubscriptionStateUpdate,
    charge: ProviderCharge | null,
    now: Date,
  ): Promise<void> {
    await tx
      .update(subscriptions)
      .set({
        status: update.status,
        currentPeriodEnd: update.currentPeriodEnd === undefined ? sub.currentPeriodEnd : update.currentPeriodEnd,
        autoRenew: update.autoRenew ?? sub.autoRenew,
        cancelAtPeriodEnd: update.cancelAtPeriodEnd ?? sub.cancelAtPeriodEnd,
        planId: update.planId ?? sub.planId,
        lastVerifiedAt: update.verifiedAt,
      })
      .where(eq(subscriptions.id, sub.id));
    if (charge) {
      await this.recordCharge(tx, sub, charge);
    }
    await this.recomputeAccess(tx, sub.userId, now);
  }

  private async applySubscriptionEvent(
    tx: Executor,
    provider: BillingProvider,
    event: SubscriptionNotification,
    now: Date,
  ): Promise<ApplyOutcome> {
    const current = await this.lockSubscription(tx, provider, event.originalTransactionId);
    if (!current) {
      // The app has not verified this purchase yet; verification will fetch the current state.
      return { status: 'skipped', note: 'unknown subscription' };
    }
    const sub = current.subscription;
    if (event.occurredAt && sub.lastVerifiedAt && event.occurredAt.getTime() < sub.lastVerifiedAt.getTime()) {
      return { status: 'skipped', note: 'older than the stored state' };
    }
    let currentPeriodEnd = event.currentPeriodEnd;
    if (!currentPeriodEnd && event.extendOnePeriod) {
      const from = sub.currentPeriodEnd && sub.currentPeriodEnd.getTime() > now.getTime() ? sub.currentPeriodEnd : now;
      currentPeriodEnd = addBillingPeriod(from, current.billingPeriod);
    }
    await this.applyState(
      tx,
      sub,
      {
        status: event.status,
        currentPeriodEnd,
        autoRenew: event.autoRenew,
        cancelAtPeriodEnd: event.cancelAtPeriodEnd,
        verifiedAt: event.occurredAt ?? now,
      },
      event.charge,
      now,
    );
    if (event.refunded) {
      const [latest] = await tx
        .select({ id: billingTransactions.id })
        .from(billingTransactions)
        .where(eq(billingTransactions.subscriptionId, sub.id))
        .orderBy(desc(billingTransactions.createdAt), desc(billingTransactions.id))
        .limit(1);
      if (latest) {
        await tx.update(billingTransactions).set({ refundStatus: 'refunded' }).where(eq(billingTransactions.id, latest.id));
      }
    }
    return { status: 'processed' };
  }

  /** Marks the charge refunded; the subscription becomes `refunded` only if it was the latest charge. */
  private async applyRefund(
    tx: Executor,
    provider: BillingProvider,
    event: RefundNotification,
    now: Date,
  ): Promise<ApplyOutcome> {
    const [charge] = await tx
      .select({ id: billingTransactions.id, subscriptionId: billingTransactions.subscriptionId })
      .from(billingTransactions)
      .where(
        and(
          eq(billingTransactions.provider, provider),
          eq(billingTransactions.providerTransactionId, event.refundedTransactionId),
        ),
      )
      .limit(1);
    if (!charge) {
      return { status: 'skipped', note: 'unknown charge' };
    }
    await tx.update(billingTransactions).set({ refundStatus: 'refunded' }).where(eq(billingTransactions.id, charge.id));
    const [latest] = await tx
      .select({ id: billingTransactions.id })
      .from(billingTransactions)
      .where(eq(billingTransactions.subscriptionId, charge.subscriptionId))
      .orderBy(desc(billingTransactions.createdAt), desc(billingTransactions.id))
      .limit(1);
    if (latest?.id !== charge.id) {
      return { status: 'processed', note: 'refund of an earlier charge' };
    }
    const [sub] = await tx
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, charge.subscriptionId))
      .for('update')
      .limit(1);
    if (!sub) return { status: 'skipped', note: 'unknown subscription' };
    await this.applyState(tx, sub, { status: 'refunded', autoRenew: false, verifiedAt: event.occurredAt ?? now }, null, now);
    return { status: 'processed' };
  }

  /** Inserts a charge once; a later report of the same charge fills in missing amounts. */
  private async recordCharge(tx: Executor, sub: SubscriptionRow, charge: ProviderCharge): Promise<void> {
    await tx
      .insert(billingTransactions)
      .values({
        subscriptionId: sub.id,
        provider: sub.provider,
        providerTransactionId: charge.transactionId,
        originalTransactionId: sub.providerSubscriptionId,
        currency: charge.currency,
        grossAmountMinor: charge.grossAmountMinor,
        taxAmountMinor: charge.taxAmountMinor,
      })
      .onConflictDoUpdate({
        target: [billingTransactions.provider, billingTransactions.providerTransactionId],
        set: {
          currency: sql`coalesce(${billingTransactions.currency}, excluded.currency)`,
          grossAmountMinor: sql`coalesce(${billingTransactions.grossAmountMinor}, excluded.gross_amount_minor)`,
          taxAmountMinor: sql`coalesce(${billingTransactions.taxAmountMinor}, excluded.tax_amount_minor)`,
        },
      });
  }

  /** Recomputes the entitlement; when premium access is lost, open premium playback is revoked. */
  private async recomputeAccess(tx: Executor, userId: string, now: Date): Promise<void> {
    const { hadAccess, hasAccess } = await this.entitlements.recomputeForUser(tx, userId, now);
    if (hadAccess && !hasAccess) {
      await revokePlaybackSessions(tx, { userId, premiumOnly: true }, ENTITLEMENT_LOST_REASON, now);
    }
  }
}
