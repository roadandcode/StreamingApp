import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { billingTransactions, subscriptions } from '../../src/database/schema';
import {
  bearer,
  createTestApp,
  http,
  loginAdmin,
  pathOf,
  registerDevice,
  registerUser,
  resetDatabase,
  SEED_IDS,
  sendFakeWebhook,
  type TestContext,
  type TestUser,
} from '../support/test-app';

describe('devices, regions, subscription states and errors (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    await resetDatabase();
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx?.close();
  });

  describe('devices', () => {
    it('allows MAX_DEVICES active devices and refuses one more with 409', async () => {
      const user = await registerUser(ctx.app);
      const ids: string[] = [];
      for (let i = 0; i < 3; i += 1) ids.push(await registerDevice(ctx.app, user));
      const fourth = await http(ctx.app)
        .post('/v1/me/devices')
        .set(bearer(user.accessToken))
        .send({ installationId: randomUUID(), platform: 'ios', name: 'iPad' })
        .expect(409);
      expect(fourth.body).toEqual({ statusCode: 409, code: 'DEVICE_LIMIT_REACHED', message: expect.any(String) });

      // Removing one frees a slot.
      const removed = await http(ctx.app).get('/v1/me/devices').set(bearer(user.accessToken)).expect(200);
      const removedInstallation = (removed.body as Array<{ id: string; installationId: string }>).find(
        (d) => d.id === ids[0],
      )?.installationId;
      await http(ctx.app).delete(`/v1/me/devices/${ids[0]}`).set(bearer(user.accessToken)).expect(204);
      await registerDevice(ctx.app, user);
      const list = await http(ctx.app).get('/v1/me/devices').set(bearer(user.accessToken)).expect(200);
      expect(list.body).toHaveLength(3);

      // Re-activating the removed device is subject to the limit too.
      const reactivate = await http(ctx.app)
        .post('/v1/me/devices')
        .set(bearer(user.accessToken))
        .send({ installationId: removedInstallation, platform: 'android', name: 'Back again' })
        .expect(409);
      expect(reactivate.body.code).toBe('DEVICE_LIMIT_REACHED');
    });

    it("refuses another user's device id: 403 DEVICE_NOT_REGISTERED", async () => {
      const owner = await registerUser(ctx.app);
      const ownerDevice = await registerDevice(ctx.app, owner);
      const intruder = await registerUser(ctx.app);
      const response = await http(ctx.app)
        .post('/v1/playback/sessions')
        .set(bearer(intruder.accessToken))
        .send({ contentId: SEED_IDS.freeLesson1, deviceId: ownerDevice })
        .expect(403);
      expect(response.body.code).toBe('DEVICE_NOT_REGISTERED');
      await http(ctx.app).delete(`/v1/me/devices/${ownerDevice}`).set(bearer(intruder.accessToken)).expect(404);
    });

    it('refuses a course container: 403 CONTENT_NOT_PLAYABLE', async () => {
      const user = await registerUser(ctx.app);
      const device = await registerDevice(ctx.app, user);
      const response = await http(ctx.app)
        .post('/v1/playback/sessions')
        .set(bearer(user.accessToken))
        .send({ contentId: SEED_IDS.freeCourse, deviceId: device })
        .expect(403);
      expect(response.body.code).toBe('CONTENT_NOT_PLAYABLE');
      const missing = await http(ctx.app)
        .post('/v1/playback/sessions')
        .set(bearer(user.accessToken))
        .send({ contentId: randomUUID(), deviceId: device })
        .expect(404);
      expect(missing.body.code).toBe('NOT_FOUND');
    });
  });

  describe('regions', () => {
    let usOnlyId: string;
    let viewer: TestUser;
    let deviceId: string;

    beforeAll(async () => {
      const admin = await loginAdmin(ctx.app);
      const invalid = await http(ctx.app)
        .post('/v1/admin/content')
        .set(bearer(admin.accessToken))
        .send({ kind: 'video', title: '', description: 'x', accessTier: 'free', defaultLanguage: 'en', regions: ['US', 'usa'] })
        .expect(400);
      expect(invalid.body.errors).toEqual([
        { field: 'title', message: 'title should not be empty' },
        { field: 'regions.1', message: 'regions.1 must be an ISO-3166 alpha-2 country code' },
      ]);
      const created = await http(ctx.app)
        .post('/v1/admin/content')
        .set(bearer(admin.accessToken))
        .send({
          kind: 'video',
          title: 'US only video',
          description: 'Licensed for the US only',
          accessTier: 'free',
          defaultLanguage: 'en',
          regions: ['US'],
        })
        .expect(201);
      usOnlyId = (created.body as { id: string }).id;
      const upload = await http(ctx.app)
        .post(`/v1/admin/content/${usOnlyId}/upload-session`)
        .set(bearer(admin.accessToken))
        .expect(201);
      await http(ctx.app).put(pathOf((upload.body as { uploadUrl: string }).uploadUrl)).send('bytes').expect(204);
      await http(ctx.app).post(`/v1/admin/content/${usOnlyId}/publish`).set(bearer(admin.accessToken)).expect(200);
      viewer = await registerUser(ctx.app);
      deviceId = await registerDevice(ctx.app, viewer);
    });

    it('hides US-only content from an IN viewer in the catalog and detail', async () => {
      const catalog = await http(ctx.app).get('/v1/catalog').expect(200);
      const ids = (catalog.body as { items: Array<{ id: string }> }).items.map((item) => item.id);
      expect(ids).toEqual([SEED_IDS.freeCourse, SEED_IDS.premiumCourse]);
      expect(catalog.body).toMatchObject({ page: 1, pageSize: 20, total: 2 });

      const detail = await http(ctx.app).get(`/v1/content/${usOnlyId}`).expect(404);
      expect(detail.body).toEqual({ statusCode: 404, code: 'NOT_FOUND', message: expect.any(String) });
    });

    it('shows it to a US viewer (country from the trusted CDN header)', async () => {
      const catalog = await http(ctx.app).get('/v1/catalog').set('x-test-viewer-country', 'US').expect(200);
      const ids = (catalog.body as { items: Array<{ id: string }> }).items.map((item) => item.id);
      expect(ids).toEqual([usOnlyId]);
      await http(ctx.app).get(`/v1/content/${usOnlyId}`).set('x-test-viewer-country', 'us').expect(200);
    });

    it('refuses playback for an IN viewer: 403 REGION_NOT_ALLOWED', async () => {
      const response = await http(ctx.app)
        .post('/v1/playback/sessions')
        .set(bearer(viewer.accessToken))
        .send({ contentId: usOnlyId, deviceId })
        .expect(403);
      expect(response.body.code).toBe('REGION_NOT_ALLOWED');
    });

    it('returns course detail with ordered lessons and subtitles', async () => {
      const detail = await http(ctx.app).get(`/v1/content/${SEED_IDS.freeCourse}`).expect(200);
      expect(detail.body).toMatchObject({
        id: SEED_IDS.freeCourse,
        kind: 'course',
        accessTier: 'free',
        parentId: null,
        playable: false,
        children: [{ id: SEED_IDS.freeLesson1 }, { id: SEED_IDS.freeLesson2 }],
      });
      const lesson = await http(ctx.app).get(`/v1/content/${SEED_IDS.freeLesson1}`).expect(200);
      expect(lesson.body).toMatchObject({ playable: true, subtitles: [{ language: 'en', label: 'English' }] });
      const filtered = await http(ctx.app).get('/v1/catalog?language=hi&kind=course').expect(200);
      expect((filtered.body as { items: Array<{ id: string }> }).items.map((i) => i.id)).toEqual([SEED_IDS.premiumCourse]);
    });
  });

  describe('subscription states from store events', () => {
    async function subscribe(): Promise<{ user: TestUser; receipt: string }> {
      const user = await registerUser(ctx.app);
      const receipt = `fake-txn-${randomUUID()}`;
      await http(ctx.app)
        .post('/v1/purchases/verify')
        .set(bearer(user.accessToken))
        .send({ provider: 'fake', productId: 'fake_premium_yearly', receipt })
        .expect(200);
      return { user, receipt };
    }

    const view = async (user: TestUser) =>
      (await http(ctx.app).get('/v1/me/subscription').set(bearer(user.accessToken)).expect(200)).body as Record<
        string,
        unknown
      >;

    it('CANCELLED keeps access until the period ends', async () => {
      const { user, receipt } = await subscribe();
      await sendFakeWebhook(ctx.app, { eventId: randomUUID(), type: 'CANCELLED', originalTransactionId: receipt }).expect(200);
      expect(await view(user)).toMatchObject({ status: 'cancelled', hasAccess: true, autoRenewEnabled: false });

      const past = new Date(Date.now() - 1000).toISOString();
      await sendFakeWebhook(ctx.app, {
        eventId: randomUUID(),
        type: 'CANCELLED',
        originalTransactionId: receipt,
        expiresAt: past,
      }).expect(200);
      expect(await view(user)).toMatchObject({ status: 'cancelled', hasAccess: false, accessUntil: past });
    });

    it('GRACE_PERIOD keeps access; BILLING_RETRY does not', async () => {
      const { user, receipt } = await subscribe();
      const graceEnd = new Date(Date.now() + 3 * 86_400_000).toISOString();
      await sendFakeWebhook(ctx.app, {
        eventId: randomUUID(),
        type: 'GRACE_PERIOD',
        originalTransactionId: receipt,
        expiresAt: graceEnd,
      }).expect(200);
      expect(await view(user)).toMatchObject({ status: 'grace_period', hasAccess: true, accessUntil: graceEnd });

      await sendFakeWebhook(ctx.app, { eventId: randomUUID(), type: 'BILLING_RETRY', originalTransactionId: receipt }).expect(200);
      expect(await view(user)).toMatchObject({ status: 'billing_retry', hasAccess: false, accessTier: null });

      const device = await registerDevice(ctx.app, user);
      const playback = await http(ctx.app)
        .post('/v1/playback/sessions')
        .set(bearer(user.accessToken))
        .send({ contentId: SEED_IDS.premiumLesson1, deviceId: device })
        .expect(403);
      expect(playback.body.code).toBe('ENTITLEMENT_REQUIRED');
    });

    it('REFUNDED removes access and marks the transaction refunded', async () => {
      const { user, receipt } = await subscribe();
      await sendFakeWebhook(ctx.app, { eventId: randomUUID(), type: 'REFUNDED', originalTransactionId: receipt }).expect(200);
      expect(await view(user)).toMatchObject({ status: 'refunded', hasAccess: false });
      const [sub] = await ctx.db.select().from(subscriptions).where(eq(subscriptions.providerSubscriptionId, receipt));
      const transactions = await ctx.db
        .select()
        .from(billingTransactions)
        .where(eq(billingTransactions.subscriptionId, sub.id));
      expect(transactions.map((t) => t.refundStatus)).toEqual(['refunded']);
    });

    it('REVOKED removes access; events for unknown subscriptions are accepted and skipped', async () => {
      const { user, receipt } = await subscribe();
      await sendFakeWebhook(ctx.app, { eventId: randomUUID(), type: 'REVOKED', originalTransactionId: receipt }).expect(200);
      expect(await view(user)).toMatchObject({ status: 'revoked', hasAccess: false });
      const unknown = await sendFakeWebhook(ctx.app, {
        eventId: randomUUID(),
        type: 'RENEWED',
        originalTransactionId: 'never-verified',
      }).expect(200);
      expect(unknown.body).toEqual({ duplicate: false });
    });

    it('rejects malformed signed events with 400', async () => {
      const response = await sendFakeWebhook(ctx.app, { eventId: 'x', type: 'UPGRADED', originalTransactionId: 'y' }).expect(400);
      expect(response.body.code).toBe('VALIDATION_FAILED');
    });

    it('Apple and Google webhooks fail closed with 503', async () => {
      for (const provider of ['apple', 'google']) {
        const response = await http(ctx.app).post(`/v1/webhooks/${provider}`).send({ signedPayload: 'x' }).expect(503);
        expect(response.body.code).toBe('PROVIDER_NOT_CONFIGURED');
      }
    });
  });

  describe('admin users', () => {
    it('finds users, shows devices and active playback, and audits revocations', async () => {
      const admin = await loginAdmin(ctx.app);
      const user = await registerUser(ctx.app, 'support-case');
      const device = await registerDevice(ctx.app, user);
      const session = await http(ctx.app)
        .post('/v1/playback/sessions')
        .set(bearer(user.accessToken))
        .send({ contentId: SEED_IDS.freeLesson1, deviceId: device })
        .expect(201);
      const sessionId = (session.body as { playbackSessionId: string }).playbackSessionId;

      const list = await http(ctx.app)
        .get('/v1/admin/users?email=SUPPORT-CASE')
        .set(bearer(admin.accessToken))
        .expect(200);
      expect(list.body).toMatchObject({
        total: 1,
        items: [{ user: { id: user.id }, subscription: { status: 'none', hasAccess: false } }],
      });

      const detail = await http(ctx.app).get(`/v1/admin/users/${user.id}`).set(bearer(admin.accessToken)).expect(200);
      expect(detail.body).toMatchObject({
        user: { id: user.id },
        devices: [{ id: device }],
        activePlaybackSessions: [{ id: sessionId, contentId: SEED_IDS.freeLesson1, contentTitle: 'Welcome', deviceId: device }],
      });

      await http(ctx.app).post(`/v1/admin/playback-sessions/${sessionId}/revoke`).set(bearer(admin.accessToken)).expect(204);
      const beat = await http(ctx.app)
        .post(`/v1/playback/sessions/${sessionId}/heartbeat`)
        .set(bearer(user.accessToken))
        .send({})
        .expect(403);
      expect(beat.body.code).toBe('PLAYBACK_SESSION_ENDED');

      await http(ctx.app).post(`/v1/admin/devices/${device}/revoke`).set(bearer(admin.accessToken)).expect(204);
      const devices = await http(ctx.app).get(`/v1/admin/users/${user.id}`).set(bearer(admin.accessToken)).expect(200);
      expect((devices.body as { devices: Array<{ revokedAt: string | null }> }).devices[0]?.revokedAt).not.toBeNull();

      await http(ctx.app).post(`/v1/admin/users/${user.id}/sessions/revoke`).set(bearer(admin.accessToken)).expect(204);
      await http(ctx.app).get('/v1/me').set(bearer(user.accessToken)).expect(401);
      await http(ctx.app).post('/v1/auth/refresh').send({ refreshToken: user.refreshToken }).expect(401);

      await http(ctx.app).post(`/v1/admin/users/${randomUUID()}/sessions/revoke`).set(bearer(admin.accessToken)).expect(404);
    });
  });

  describe('global behaviour', () => {
    it('reports health', async () => {
      await http(ctx.app).get('/v1/health').expect(200, { status: 'ok', db: 'ok' });
    });

    it('lists plans with store product ids', async () => {
      const plans = await http(ctx.app).get('/v1/plans').expect(200);
      expect(plans.body).toEqual([
        {
          code: 'premium_monthly',
          name: 'Premium (monthly)',
          billingPeriod: 'P1M',
          accessTier: 'premium',
          storeProducts: [
            { provider: 'apple', productId: 'com.roadandcode.streamingapp.premium.monthly' },
            { provider: 'google', productId: 'premium_monthly' },
            { provider: 'fake', productId: 'fake_premium_monthly' },
          ],
        },
        {
          code: 'premium_yearly',
          name: 'Premium (yearly)',
          billingPeriod: 'P1Y',
          accessTier: 'premium',
          storeProducts: [
            { provider: 'apple', productId: 'com.roadandcode.streamingapp.premium.yearly' },
            { provider: 'google', productId: 'premium_yearly' },
            { provider: 'fake', productId: 'fake_premium_yearly' },
          ],
        },
      ]);
    });

    it('uses the error shape for validation, malformed JSON, unknown routes and missing auth', async () => {
      const short = await http(ctx.app).post('/v1/auth/register').send({ email: 'a@e2e.test', password: 'short' }).expect(400);
      expect(short.body).toEqual({
        statusCode: 400,
        code: 'VALIDATION_FAILED',
        message: expect.stringContaining('password'),
        errors: [{ field: 'password', message: expect.stringContaining('password') }],
      });

      const badId = await http(ctx.app).get('/v1/content/not-a-uuid').expect(400);
      expect(badId.body.errors).toEqual([{ field: 'id', message: 'id must be a UUID' }]);

      const malformed = await http(ctx.app)
        .post('/v1/auth/login')
        .set('Content-Type', 'application/json')
        .send('{"email":')
        .expect(400);
      expect(malformed.body).toEqual({ statusCode: 400, code: 'VALIDATION_FAILED', message: expect.any(String), errors: [] });

      const unknownQuery = await http(ctx.app).get('/v1/catalog?sort=title').expect(400);
      expect(unknownQuery.body).toMatchObject({ code: 'VALIDATION_FAILED', errors: [{ field: 'sort' }] });

      const missing = await http(ctx.app).get('/v1/nope').expect(404);
      expect(missing.body).toEqual({ statusCode: 404, code: 'NOT_FOUND', message: expect.any(String) });

      const anonymous = await http(ctx.app).get('/v1/me').expect(401);
      expect(anonymous.body).toEqual({ statusCode: 401, code: 'UNAUTHENTICATED', message: expect.any(String) });
      await http(ctx.app).get('/v1/me').set('Authorization', 'Bearer not.a.jwt').expect(401);
    });

    it('sets security headers and CORS for the admin origin (including PUT for uploads)', async () => {
      const preflight = await http(ctx.app)
        .options('/v1/dev/media/uploads/x')
        .set('Origin', 'http://localhost:3001')
        .set('Access-Control-Request-Method', 'PUT')
        .expect(204);
      expect(preflight.headers['access-control-allow-origin']).toBe('http://localhost:3001');
      expect(preflight.headers['access-control-allow-methods']).toContain('PUT');

      // The viewer website's player fetches fake media URLs directly from the browser.
      const webPreflight = await http(ctx.app)
        .options('/v1/dev/media/fake_x/manifest.m3u8')
        .set('Origin', 'http://localhost:3002')
        .set('Access-Control-Request-Method', 'GET')
        .expect(204);
      expect(webPreflight.headers['access-control-allow-origin']).toBe('http://localhost:3002');

      const health = await http(ctx.app).get('/v1/health').set('Origin', 'https://evil.example').expect(200);
      expect(health.headers['access-control-allow-origin']).toBeUndefined();
      expect(health.headers['x-content-type-options']).toBe('nosniff');
      expect(health.headers['x-powered-by']).toBeUndefined();
    });
  });
});
