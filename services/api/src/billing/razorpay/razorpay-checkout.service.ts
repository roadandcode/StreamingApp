import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { AppException } from '../../common/errors';
import { AppConfig } from '../../config/app-config';
import { isRazorpayConfigured } from '../../config/env.schema';
import { type Database, DRIZZLE } from '../../database/database.types';
import { plans, storeProducts, subscriptions } from '../../database/schema';
import type { SubscriptionViewDto } from '../billing.dto';
import { BillingService } from '../billing.service';
import { DEFAULT_STOREFRONT, PlansService } from '../plans.service';
import { RAZORPAY_CLIENT, type RazorpayClient } from './razorpay-client';
import { mapRazorpaySubscriptionStatus, subscriptionState } from './razorpay-events';
import { verifyCheckoutSignature } from './razorpay-signatures';
import type { RazorpayCheckoutSubscriptionDto, VerifyRazorpayCheckoutDto } from './razorpay.dto';

/** Billing cycles requested from Razorpay per subscription (Razorpay needs a finite count). */
export const RAZORPAY_TOTAL_COUNT = { P1M: 120, P1Y: 10 } as const;

/**
 * Web checkout: creates Razorpay subscriptions for a plan and applies the result of Checkout.
 * Renewals, failures and cancellations arrive later by webhook; `verify` is only the fast path.
 */
@Injectable()
export class RazorpayCheckoutService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(RAZORPAY_CLIENT) private readonly razorpay: RazorpayClient,
    private readonly config: AppConfig,
    private readonly billing: BillingService,
    private readonly plans: PlansService,
  ) {}

  private credentials(): { keyId: string; keySecret: string } {
    const keyId = this.config.get('RAZORPAY_KEY_ID');
    const keySecret = this.config.get('RAZORPAY_KEY_SECRET');
    const configured = isRazorpayConfigured({
      RAZORPAY_KEY_ID: keyId,
      RAZORPAY_KEY_SECRET: keySecret,
      RAZORPAY_WEBHOOK_SECRET: this.config.get('RAZORPAY_WEBHOOK_SECRET'),
    });
    if (!configured || !keyId || !keySecret) {
      throw new AppException('PROVIDER_NOT_CONFIGURED');
    }
    return { keyId, keySecret };
  }

  async createSubscription(userId: string, planCode: string): Promise<RazorpayCheckoutSubscriptionDto> {
    const { keyId } = this.credentials();
    const [plan] = await this.db.select().from(plans).where(eq(plans.code, planCode)).limit(1);
    if (!plan) {
      throw new AppException('NOT_FOUND', 'Unknown plan.');
    }
    const [product] = await this.db
      .select({ productId: storeProducts.productId })
      .from(storeProducts)
      .where(
        and(
          eq(storeProducts.planId, plan.id),
          eq(storeProducts.provider, 'razorpay'),
          eq(storeProducts.storefront, DEFAULT_STOREFRONT),
        ),
      )
      .limit(1);
    if (!product) {
      throw new AppException('INVALID_PURCHASE', 'This plan is not available for web checkout.');
    }
    const created = await this.razorpay.createSubscription({
      planId: product.productId,
      totalCount: RAZORPAY_TOTAL_COUNT[plan.billingPeriod],
      notes: { userId, planCode },
    });
    await this.db.insert(subscriptions).values({
      userId,
      planId: plan.id,
      provider: 'razorpay',
      providerSubscriptionId: created.id,
      status: mapRazorpaySubscriptionStatus(created.status),
      currentPeriodEnd: null,
      autoRenew: true,
      lastVerifiedAt: new Date(),
    });
    return { razorpaySubscriptionId: created.id, keyId, planCode };
  }

  /**
   * Checks the Checkout signature, that the subscription belongs to the caller, then re-reads the
   * subscription from Razorpay and applies it in one transaction.
   */
  async verify(userId: string, dto: VerifyRazorpayCheckoutDto): Promise<SubscriptionViewDto> {
    const { keySecret } = this.credentials();
    if (!verifyCheckoutSignature(keySecret, dto.razorpayPaymentId, dto.razorpaySubscriptionId, dto.razorpaySignature)) {
      throw new AppException('INVALID_PURCHASE', 'The payment signature is invalid.');
    }
    const [owned] = await this.db
      .select({ userId: subscriptions.userId })
      .from(subscriptions)
      .where(and(eq(subscriptions.provider, 'razorpay'), eq(subscriptions.providerSubscriptionId, dto.razorpaySubscriptionId)))
      .limit(1);
    if (!owned) {
      throw new AppException('INVALID_PURCHASE', 'Unknown subscription.');
    }
    if (owned.userId !== userId) {
      throw new AppException('PURCHASE_BELONGS_TO_OTHER_ACCOUNT');
    }

    const entity = await this.razorpay.fetchSubscription(dto.razorpaySubscriptionId);
    if (entity.id !== dto.razorpaySubscriptionId) {
      throw new AppException('INVALID_PURCHASE', 'Razorpay returned a different subscription.');
    }
    const status = mapRazorpaySubscriptionStatus(entity.status);
    const state = subscriptionState(entity, status);
    const plan = await this.plans.findPlanForProduct('razorpay', entity.plan_id);
    const now = new Date();
    await this.db.transaction(async (tx) => {
      const locked = await this.billing.lockSubscription(tx, 'razorpay', dto.razorpaySubscriptionId);
      if (!locked) throw new AppException('INVALID_PURCHASE', 'Unknown subscription.');
      await this.billing.applyState(
        tx,
        locked.subscription,
        {
          status,
          currentPeriodEnd: state.currentPeriodEnd,
          autoRenew: state.autoRenew,
          cancelAtPeriodEnd: state.cancelAtPeriodEnd,
          planId: plan?.id,
          verifiedAt: now,
        },
        status === 'active'
          ? { transactionId: dto.razorpayPaymentId, currency: null, grossAmountMinor: null, taxAmountMinor: null }
          : null,
        now,
      );
    });
    return this.billing.getView(userId, now);
  }
}
