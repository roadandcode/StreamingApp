import { randomUUID } from 'node:crypto';
import { parseEnv } from '../../src/config/env.schema';
import {
  bearer,
  createTestApp,
  http,
  loginAdmin,
  registerDevice,
  registerUser,
  resetDatabase,
  SEED_IDS,
  type TestContext,
} from '../support/test-app';

describe('provider modes and limits (e2e)', () => {
  beforeAll(async () => {
    await resetDatabase();
  });

  describe('real providers not configured (MEDIA_PROVIDER=aws, BILLING_MODE=live)', () => {
    let ctx: TestContext;

    beforeAll(async () => {
      ctx = await createTestApp({
        MEDIA_PROVIDER: 'aws',
        BILLING_MODE: 'live',
        FAKE_MEDIA_SIGNING_SECRET: undefined,
        FAKE_WEBHOOK_SECRET: undefined,
      });
    });

    afterAll(async () => {
      await ctx?.close();
    });

    it('does not mount the fake routes', async () => {
      await http(ctx.app).get('/v1/dev/media/x/manifest.m3u8?sid=a&exp=1&sig=b').expect(404);
      await http(ctx.app).put('/v1/dev/media/uploads/x?exp=1&sig=b').send('x').expect(404);
      await http(ctx.app).post('/v1/webhooks/fake').send({}).expect(404);
    });

    it('fails closed: playback and uploads return 503, fake purchases are refused', async () => {
      const user = await registerUser(ctx.app);
      const device = await registerDevice(ctx.app, user);
      const playback = await http(ctx.app)
        .post('/v1/playback/sessions')
        .set(bearer(user.accessToken))
        .send({ contentId: SEED_IDS.freeLesson1, deviceId: device })
        .expect(503);
      expect(playback.body).toEqual({ statusCode: 503, code: 'PROVIDER_NOT_CONFIGURED', message: expect.any(String) });

      const admin = await loginAdmin(ctx.app);
      const upload = await http(ctx.app)
        .post(`/v1/admin/content/${SEED_IDS.freeLesson2}/upload-session`)
        .set(bearer(admin.accessToken))
        .expect(503);
      expect(upload.body.code).toBe('PROVIDER_NOT_CONFIGURED');

      const fakePurchase = await http(ctx.app)
        .post('/v1/purchases/verify')
        .set(bearer(user.accessToken))
        .send({ provider: 'fake', productId: 'fake_premium_monthly', receipt: randomUUID() })
        .expect(400);
      expect(fakePurchase.body.code).toBe('INVALID_PURCHASE');

      const plans = await http(ctx.app).get('/v1/plans').expect(200);
      const providers = (plans.body as Array<{ storeProducts: Array<{ provider: string }> }>).flatMap((plan) =>
        plan.storeProducts.map((product) => product.provider),
      );
      expect(providers).not.toContain('fake');
    });
  });

  describe('rate limiting', () => {
    let ctx: TestContext;

    beforeAll(async () => {
      ctx = await createTestApp({ THROTTLE_AUTH_LIMIT: '3', THROTTLE_PLAYBACK_LIMIT: '2' });
    });

    afterAll(async () => {
      await ctx?.close();
    });

    it('throttles auth routes with 429 RATE_LIMITED', async () => {
      const attempt = () => http(ctx.app).post('/v1/auth/login').send({ email: 'nobody@e2e.test', password: 'whatever-123' });
      await attempt().expect(401);
      await attempt().expect(401);
      await attempt().expect(401);
      const limited = await attempt().expect(429);
      expect(limited.body).toEqual({ statusCode: 429, code: 'RATE_LIMITED', message: expect.any(String) });
      // Other routes are not throttled.
      await http(ctx.app).get('/v1/catalog').expect(200);
    });
  });

  describe('startup validation', () => {
    it('refuses fake providers in production', () => {
      expect(() => parseEnv({ ...process.env, NODE_ENV: 'production' })).toThrow(/MEDIA_PROVIDER/);
    });
  });
});
