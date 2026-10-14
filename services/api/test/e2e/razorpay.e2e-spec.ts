import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import {
  RAZORPAY_CLIENT,
  type CreateRazorpaySubscription,
  type RazorpayClient,
  type RazorpaySubscription,
} from '../../src/billing/razorpay/razorpay-client';
import { signCheckout, signWebhook } from '../../src/billing/razorpay/razorpay-signatures';
import { billingTransactions, providerEvents, subscriptions } from '../../src/database/schema';
import {
  bearer,
  createTestApp,
  http,
  registerDevice,
  registerUser,
  resetDatabase,
  SEED_IDS,
  type TestContext,
  type TestUser,
} from '../support/test-app';

const RAZORPAY_ENV = {
  RAZORPAY_KEY_ID: 'rzp_test_e2e_key',
  RAZORPAY_KEY_SECRET: 'rzp-e2e-key-secret',
  RAZORPAY_WEBHOOK_SECRET: 'rzp-e2e-webhook-secret',
};
const PLAN_IDS = { monthly: 'plan_e2e_monthly', yearly: 'plan_e2e_yearly' };

/** In-memory stand-in for the Razorpay Subscriptions API. */
class StubRazorpayClient implements RazorpayClient {
  readonly subscriptions = new Map<string, RazorpaySubscription>();
  readonly created: CreateRazorpaySubscription[] = [];

  createSubscription(input: CreateRazorpaySubscription): Promise<RazorpaySubscription> {
    this.created.push(input);
    const subscription: RazorpaySubscription = {
      id: `sub_${randomUUID().replace(/-/g, '').slice(0, 14)}`,
      plan_id: input.planId,
      status: 'created',
      current_start: null,
      current_end: null,
    };
    this.subscriptions.set(subscription.id, subscription);
    return Promise.resolve({ ...subscription });
  }

  fetchSubscription(subscriptionId: string): Promise<RazorpaySubscription> {
    const subscription = this.subscriptions.get(subscriptionId);
    return subscription ? Promise.resolve({ ...subscription }) : Promise.reject(new Error('not found'));
  }

  /** What Razorpay reports after a successful first charge in Checkout. */
  activate(subscriptionId: string, days = 30): void {
    const now = Math.floor(Date.now() / 1000);
    const subscription = this.subscriptions.get(subscriptionId);
    if (subscription) {
      Object.assign(subscription, { status: 'active', current_start: now, current_end: now + days * 86_400 });
    }
  }
}

describe('Razorpay web checkout (e2e)', () => {
  describe('configured', () => {
    let ctx: TestContext;
    const stub = new StubRazorpayClient();
    let buyer: TestUser;
    let subscriptionId: string;
    const paymentId = `pay_${randomUUID().replace(/-/g, '').slice(0, 14)}`;

    const subscriptionView = async (user: TestUser) =>
      (await http(ctx.app).get('/v1/me/subscription').set(bearer(user.accessToken)).expect(200)).body as Record<
        string,
        unknown
      >;

    const sendWebhook = (body: Record<string, unknown>, eventId: string, signature?: string) => {
      const raw = JSON.stringify(body);
      return http(ctx.app)
        .post('/v1/webhooks/razorpay')
        .set('Content-Type', 'application/json')
        .set('X-Razorpay-Event-Id', eventId)
        .set('X-Razorpay-Signature', signature ?? signWebhook(RAZORPAY_ENV.RAZORPAY_WEBHOOK_SECRET, raw))
        .send(raw);
    };

    const subscriptionEvent = (event: string, status: string, extra: Record<string, unknown> = {}) => ({
      entity: 'event',
      account_id: 'acc_e2e',
      event,
      contains: ['subscription'],
      // Later than the checkout verification.
      created_at: Math.floor(Date.now() / 1000) + 5,
      payload: {
        subscription: {
          entity: {
            id: subscriptionId,
            entity: 'subscription',
            plan_id: PLAN_IDS.monthly,
            status,
            current_start: Math.floor(Date.now() / 1000),
            current_end: Math.floor(Date.now() / 1000) + 30 * 86_400,
          },
        },
        ...extra,
      },
    });

    beforeAll(async () => {
      await resetDatabase({ razorpayPlanIds: PLAN_IDS });
      ctx = await createTestApp(RAZORPAY_ENV, [{ token: RAZORPAY_CLIENT, value: stub }]);
      buyer = await registerUser(ctx.app, 'web-buyer');
    });

    afterAll(async () => {
      await ctx?.close();
    });

    it('lists the Razorpay plan ids with the plans', async () => {
      const plans = await http(ctx.app).get('/v1/plans').expect(200);
      const monthly = (plans.body as Array<{ code: string; storeProducts: Array<{ provider: string; productId: string }> }>).find(
        (plan) => plan.code === 'premium_monthly',
      );
      expect(monthly?.storeProducts).toContainEqual({ provider: 'razorpay', productId: PLAN_IDS.monthly });
    });

    it('creates a checkout subscription and stores it as pending', async () => {
      const response = await http(ctx.app)
        .post('/v1/checkout/razorpay/subscriptions')
        .set(bearer(buyer.accessToken))
        .send({ planCode: 'premium_monthly' })
        .expect(201);
      const body = response.body as { razorpaySubscriptionId: string; keyId: string; planCode: string };
      expect(body).toEqual({
        razorpaySubscriptionId: expect.stringMatching(/^sub_/),
        keyId: RAZORPAY_ENV.RAZORPAY_KEY_ID,
        planCode: 'premium_monthly',
      });
      subscriptionId = body.razorpaySubscriptionId;
      expect(stub.created.at(-1)).toMatchObject({ planId: PLAN_IDS.monthly, totalCount: 120 });

      const [row] = await ctx.db
        .select()
        .from(subscriptions)
        .where(and(eq(subscriptions.provider, 'razorpay'), eq(subscriptions.providerSubscriptionId, subscriptionId)));
      expect(row).toMatchObject({ userId: buyer.id, status: 'pending' });
      expect(await subscriptionView(buyer)).toMatchObject({ status: 'pending', hasAccess: false, provider: 'razorpay' });

      const unknownPlan = await http(ctx.app)
        .post('/v1/checkout/razorpay/subscriptions')
        .set(bearer(buyer.accessToken))
        .send({ planCode: 'no_such_plan' })
        .expect(404);
      expect(unknownPlan.body.code).toBe('NOT_FOUND');
    });

    it('rejects a bad checkout signature with 400 INVALID_PURCHASE', async () => {
      stub.activate(subscriptionId);
      const response = await http(ctx.app)
        .post('/v1/checkout/razorpay/verify')
        .set(bearer(buyer.accessToken))
        .send({
          razorpaySubscriptionId: subscriptionId,
          razorpayPaymentId: paymentId,
          razorpaySignature: signCheckout('not-the-key-secret', paymentId, subscriptionId),
        })
        .expect(400);
      expect(response.body.code).toBe('INVALID_PURCHASE');
      expect(await subscriptionView(buyer)).toMatchObject({ hasAccess: false });
    });

    it('refuses another user verifying this subscription with 409', async () => {
      const other = await registerUser(ctx.app, 'web-other');
      const response = await http(ctx.app)
        .post('/v1/checkout/razorpay/verify')
        .set(bearer(other.accessToken))
        .send({
          razorpaySubscriptionId: subscriptionId,
          razorpayPaymentId: paymentId,
          razorpaySignature: signCheckout(RAZORPAY_ENV.RAZORPAY_KEY_SECRET, paymentId, subscriptionId),
        })
        .expect(409);
      expect(response.body.code).toBe('PURCHASE_BELONGS_TO_OTHER_ACCOUNT');
    });

    it('verifies a correctly signed checkout: hasAccess true, payment recorded', async () => {
      const response = await http(ctx.app)
        .post('/v1/checkout/razorpay/verify')
        .set(bearer(buyer.accessToken))
        .send({
          razorpaySubscriptionId: subscriptionId,
          razorpayPaymentId: paymentId,
          razorpaySignature: signCheckout(RAZORPAY_ENV.RAZORPAY_KEY_SECRET, paymentId, subscriptionId),
        })
        .expect(200);
      expect(response.body).toMatchObject({
        status: 'active',
        hasAccess: true,
        accessTier: 'premium',
        planCode: 'premium_monthly',
        provider: 'razorpay',
        autoRenewEnabled: true,
      });
      const transactions = await ctx.db
        .select()
        .from(billingTransactions)
        .where(eq(billingTransactions.providerTransactionId, paymentId));
      expect(transactions).toHaveLength(1);

      // The entitlement is per account: premium playback works for the web buyer.
      const device = await registerDevice(ctx.app, buyer);
      await http(ctx.app)
        .post('/v1/playback/sessions')
        .set(bearer(buyer.accessToken))
        .send({ contentId: SEED_IDS.premiumLesson1, deviceId: device })
        .expect(201);
    });

    it('records the charge amount from subscription.charged', async () => {
      const response = await sendWebhook(
        subscriptionEvent('subscription.charged', 'active', {
          payment: { entity: { id: paymentId, entity: 'payment', amount: 19_900, currency: 'INR', status: 'captured' } },
        }),
        `evt_${randomUUID()}`,
      ).expect(200);
      expect(response.body).toEqual({ duplicate: false });
      const [transaction] = await ctx.db
        .select()
        .from(billingTransactions)
        .where(eq(billingTransactions.providerTransactionId, paymentId));
      expect(transaction).toMatchObject({ currency: 'INR', grossAmountMinor: 19_900 });
    });

    it('rejects webhooks with a bad signature or without an event id', async () => {
      const body = subscriptionEvent('subscription.halted', 'halted');
      const forged = await sendWebhook(body, `evt_${randomUUID()}`, 'f'.repeat(64)).expect(401);
      expect(forged.body.code).toBe('INVALID_SIGNATURE');
      const raw = JSON.stringify(body);
      const noId = await http(ctx.app)
        .post('/v1/webhooks/razorpay')
        .set('Content-Type', 'application/json')
        .set('X-Razorpay-Signature', signWebhook(RAZORPAY_ENV.RAZORPAY_WEBHOOK_SECRET, raw))
        .send(raw)
        .expect(400);
      expect(noId.body.code).toBe('VALIDATION_FAILED');
      expect(await subscriptionView(buyer)).toMatchObject({ hasAccess: true });
    });

    it('subscription.halted removes access; a duplicate delivery is ignored', async () => {
      const eventId = `evt_${randomUUID()}`;
      const halted = subscriptionEvent('subscription.halted', 'halted');
      await sendWebhook(halted, eventId).expect(200, { duplicate: false });
      expect(await subscriptionView(buyer)).toMatchObject({ status: 'expired', hasAccess: false });

      // Payment recovered (a newer event), then the old halted event is delivered again.
      const charged = subscriptionEvent('subscription.charged', 'active');
      charged.created_at += 5;
      await sendWebhook(charged, `evt_${randomUUID()}`).expect(200, { duplicate: false });
      expect(await subscriptionView(buyer)).toMatchObject({ status: 'active', hasAccess: true });

      await sendWebhook(halted, eventId).expect(200, { duplicate: true });
      expect(await subscriptionView(buyer)).toMatchObject({ status: 'active', hasAccess: true });
      const rows = await ctx.db
        .select()
        .from(providerEvents)
        .where(and(eq(providerEvents.provider, 'razorpay'), eq(providerEvents.eventId, eventId)));
      expect(rows).toHaveLength(1);
    });

    it('refund.processed of the latest charge marks the subscription refunded', async () => {
      const refund = {
        entity: 'event',
        event: 'refund.processed',
        contains: ['refund', 'payment'],
        created_at: Math.floor(Date.now() / 1000) + 20,
        payload: {
          refund: { entity: { id: 'rfnd_e2e', payment_id: paymentId, amount: 19_900 } },
          payment: { entity: { id: paymentId, amount: 19_900, currency: 'INR' } },
        },
      };
      await sendWebhook(refund, `evt_${randomUUID()}`).expect(200, { duplicate: false });
      expect(await subscriptionView(buyer)).toMatchObject({ status: 'refunded', hasAccess: false });
      const [transaction] = await ctx.db
        .select()
        .from(billingTransactions)
        .where(eq(billingTransactions.providerTransactionId, paymentId));
      expect(transaction?.refundStatus).toBe('refunded');
    });

    it('does not accept Razorpay on the store verification endpoint', async () => {
      const response = await http(ctx.app)
        .post('/v1/purchases/verify')
        .set(bearer(buyer.accessToken))
        .send({ provider: 'razorpay', productId: PLAN_IDS.monthly, receipt: subscriptionId })
        .expect(400);
      expect(response.body.code).toBe('INVALID_PURCHASE');
    });
  });

  describe('not configured', () => {
    let ctx: TestContext;

    beforeAll(async () => {
      await resetDatabase();
      ctx = await createTestApp({
        RAZORPAY_KEY_ID: undefined,
        RAZORPAY_KEY_SECRET: undefined,
        RAZORPAY_WEBHOOK_SECRET: undefined,
      });
    });

    afterAll(async () => {
      await ctx?.close();
    });

    it('returns 503 PROVIDER_NOT_CONFIGURED from the checkout and webhook endpoints', async () => {
      const user = await registerUser(ctx.app);
      const create = await http(ctx.app)
        .post('/v1/checkout/razorpay/subscriptions')
        .set(bearer(user.accessToken))
        .send({ planCode: 'premium_monthly' })
        .expect(503);
      expect(create.body).toEqual({ statusCode: 503, code: 'PROVIDER_NOT_CONFIGURED', message: expect.any(String) });
      const verify = await http(ctx.app)
        .post('/v1/checkout/razorpay/verify')
        .set(bearer(user.accessToken))
        .send({ razorpaySubscriptionId: 'sub_x', razorpayPaymentId: 'pay_x', razorpaySignature: 'x' })
        .expect(503);
      expect(verify.body.code).toBe('PROVIDER_NOT_CONFIGURED');
      const webhook = await http(ctx.app)
        .post('/v1/webhooks/razorpay')
        .set('X-Razorpay-Event-Id', 'evt_x')
        .set('X-Razorpay-Signature', 'x')
        .send({ event: 'subscription.charged' })
        .expect(503);
      expect(webhook.body.code).toBe('PROVIDER_NOT_CONFIGURED');
    });
  });
});
