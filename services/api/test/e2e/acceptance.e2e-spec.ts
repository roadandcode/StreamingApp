import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { auditLogs, playbackSessions, providerEvents } from '../../src/database/schema';
import { hmacHex } from '../../src/media/fake-media-signing';
import {
  bearer,
  createTestApp,
  http,
  login,
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

interface PlaybackAuthorizationBody {
  playbackSessionId: string;
  contentId: string;
  manifestUrl: string;
  expiresAt: string;
  heartbeatIntervalSeconds: number;
  drm: unknown;
}

/**
 * The v1 acceptance path, step by step against one running app. Steps share state and run in order.
 */
describe('acceptance path (e2e)', () => {
  let ctx: TestContext;
  let viewer: TestUser;
  let deviceId: string;
  let installationId: string;
  const receipt = `fake-txn-${randomUUID()}`;
  const premiumSessions: string[] = [];
  let freeSessionManifest: string;

  const startPlayback = (contentId: string, device = deviceId, user = viewer) =>
    http(ctx.app).post('/v1/playback/sessions').set(bearer(user.accessToken)).send({ contentId, deviceId: device });

  const heartbeat = (sessionId: string, user = viewer, headers: Record<string, string> = {}) =>
    http(ctx.app)
      .post(`/v1/playback/sessions/${sessionId}/heartbeat`)
      .set(bearer(user.accessToken))
      .set(headers)
      .send({ positionSeconds: 42 });

  beforeAll(async () => {
    await resetDatabase();
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx?.close();
  });

  it('registers a viewer (role is always viewer; unknown fields are rejected)', async () => {
    const escalation = await http(ctx.app)
      .post('/v1/auth/register')
      .send({ email: 'sneaky@e2e.test', password: 'long-enough-pass', role: 'admin' })
      .expect(400);
    expect(escalation.body).toEqual({ statusCode: 400, code: 'VALIDATION_FAILED', message: expect.any(String) });

    viewer = await registerUser(ctx.app);
    const me = await http(ctx.app).get('/v1/me').set(bearer(viewer.accessToken)).expect(200);
    expect(me.body).toMatchObject({ id: viewer.id, email: viewer.email, role: 'viewer', accountStatus: 'active' });

    const duplicate = await http(ctx.app)
      .post('/v1/auth/register')
      .send({ email: viewer.email.toUpperCase(), password: 'another-password' })
      .expect(409);
    expect(duplicate.body.code).toBe('EMAIL_TAKEN');
  });

  it('logs in with the right password only', async () => {
    const wrong = await http(ctx.app).post('/v1/auth/login').send({ email: viewer.email, password: 'wrong-password' });
    expect(wrong.status).toBe(401);
    expect(wrong.body.code).toBe('INVALID_CREDENTIALS');
    viewer = await login(ctx.app, viewer.email, viewer.password);
  });

  it('registers a device (201 new, 200 again)', async () => {
    installationId = randomUUID();
    deviceId = await registerDevice(ctx.app, viewer, installationId);
    const again = await http(ctx.app)
      .post('/v1/me/devices')
      .set(bearer(viewer.accessToken))
      .send({ installationId, platform: 'android', name: 'Renamed phone' })
      .expect(200);
    expect(again.body).toMatchObject({ id: deviceId, name: 'Renamed phone', revokedAt: null });
  });

  it('refuses premium playback without a subscription: 403 ENTITLEMENT_REQUIRED, no session created', async () => {
    const response = await startPlayback(SEED_IDS.premiumLesson1).expect(403);
    expect(response.body).toEqual({
      statusCode: 403,
      code: 'ENTITLEMENT_REQUIRED',
      message: expect.any(String),
    });
    const rows = await ctx.db.select().from(playbackSessions).where(eq(playbackSessions.userId, viewer.id));
    expect(rows).toHaveLength(0);
  });

  it('authorizes free playback: 201 with a short-lived manifest URL', async () => {
    const response = await startPlayback(SEED_IDS.freeLesson1).expect(201);
    const body = response.body as PlaybackAuthorizationBody;
    expect(body).toMatchObject({ contentId: SEED_IDS.freeLesson1, heartbeatIntervalSeconds: 30, drm: null });
    expect(body.manifestUrl).toMatch(
      /^http:\/\/localhost:3000\/v1\/dev\/media\/[^/]+\/manifest\.m3u8\?sid=[0-9a-f-]{36}&exp=\d+&sig=[0-9a-f]{64}$/,
    );
    const ttl = (Date.parse(body.expiresAt) - Date.now()) / 1000;
    expect(ttl).toBeGreaterThan(250);
    expect(ttl).toBeLessThanOrEqual(301);

    const beat = await heartbeat(body.playbackSessionId).expect(200);
    expect(Date.parse((beat.body as { expiresAt: string }).expiresAt)).toBeGreaterThan(Date.now());

    // End it to free the stream slot; a heartbeat on an ended session is refused.
    await http(ctx.app)
      .delete(`/v1/playback/sessions/${body.playbackSessionId}`)
      .set(bearer(viewer.accessToken))
      .expect(204);
    const ended = await heartbeat(body.playbackSessionId).expect(403);
    expect(ended.body.code).toBe('PLAYBACK_SESSION_ENDED');
  });

  it('rejects forged or unsupported purchases', async () => {
    const withStatus = await http(ctx.app)
      .post('/v1/purchases/verify')
      .set(bearer(viewer.accessToken))
      .send({ provider: 'fake', productId: 'fake_premium_monthly', receipt, status: 'active' })
      .expect(400);
    expect(withStatus.body.code).toBe('VALIDATION_FAILED');

    const unknownProduct = await http(ctx.app)
      .post('/v1/purchases/verify')
      .set(bearer(viewer.accessToken))
      .send({ provider: 'fake', productId: 'premium_monthly', receipt })
      .expect(400);
    expect(unknownProduct.body.code).toBe('INVALID_PURCHASE');

    for (const provider of ['apple', 'google']) {
      const real = await http(ctx.app)
        .post('/v1/purchases/verify')
        .set(bearer(viewer.accessToken))
        .send({ provider, productId: 'premium_monthly', receipt: 'token' })
        .expect(503);
      expect(real.body.code).toBe('PROVIDER_NOT_CONFIGURED');
    }

    const view = await http(ctx.app).get('/v1/me/subscription').set(bearer(viewer.accessToken)).expect(200);
    expect(view.body).toMatchObject({ status: 'none', hasAccess: false });
  });

  it('verifies a fake purchase and reports hasAccess', async () => {
    const verified = await http(ctx.app)
      .post('/v1/purchases/verify')
      .set(bearer(viewer.accessToken))
      .send({ provider: 'fake', productId: 'fake_premium_monthly', receipt })
      .expect(200);
    expect(verified.body).toMatchObject({ status: 'active', hasAccess: true, provider: 'fake', planCode: 'premium_monthly' });

    const view = await http(ctx.app).get('/v1/me/subscription').set(bearer(viewer.accessToken)).expect(200);
    expect(view.body).toMatchObject({
      status: 'active',
      hasAccess: true,
      accessTier: 'premium',
      planCode: 'premium_monthly',
      provider: 'fake',
      autoRenewEnabled: true,
    });
    expect(Date.parse((view.body as { accessUntil: string }).accessUntil)).toBeGreaterThan(Date.now() + 27 * 86_400_000);
  });

  it('refuses the same store purchase on another account: 409', async () => {
    const other = await registerUser(ctx.app, 'other');
    const response = await http(ctx.app)
      .post('/v1/purchases/verify')
      .set(bearer(other.accessToken))
      .send({ provider: 'fake', productId: 'fake_premium_monthly', receipt })
      .expect(409);
    expect(response.body.code).toBe('PURCHASE_BELONGS_TO_OTHER_ACCOUNT');
  });

  it('authorizes premium playback up to the concurrent-stream limit', async () => {
    const first = await startPlayback(SEED_IDS.premiumLesson1).expect(201);
    premiumSessions.push((first.body as PlaybackAuthorizationBody).playbackSessionId);
    const second = await startPlayback(SEED_IDS.premiumLesson2).expect(201);
    premiumSessions.push((second.body as PlaybackAuthorizationBody).playbackSessionId);

    const third = await startPlayback(SEED_IDS.premiumLesson1).expect(403);
    expect(third.body.code).toBe('CONCURRENT_STREAM_LIMIT');
  });

  it('applies a signed EXPIRED webhook: access lost, premium sessions revoked', async () => {
    const response = await sendFakeWebhook(ctx.app, {
      eventId: 'evt-expired-1',
      type: 'EXPIRED',
      originalTransactionId: receipt,
    }).expect(200);
    expect(response.body).toEqual({ duplicate: false });

    const view = await http(ctx.app).get('/v1/me/subscription').set(bearer(viewer.accessToken)).expect(200);
    expect(view.body).toMatchObject({ status: 'expired', hasAccess: false, accessTier: null });

    const fresh = await startPlayback(SEED_IDS.premiumLesson1).expect(403);
    expect(fresh.body.code).toBe('ENTITLEMENT_REQUIRED');

    const beat = await heartbeat(premiumSessions[0]).expect(403);
    expect(beat.body.code).toBe('PLAYBACK_SESSION_ENDED');
    const [revoked] = await ctx.db.select().from(playbackSessions).where(eq(playbackSessions.id, premiumSessions[0]));
    expect(revoked?.revokedAt).not.toBeNull();
  });

  it('ignores a repeated webhook: 200 {duplicate: true} and nothing changes', async () => {
    const before = await http(ctx.app).get('/v1/me/subscription').set(bearer(viewer.accessToken)).expect(200);
    const repeat = await sendFakeWebhook(ctx.app, {
      eventId: 'evt-expired-1',
      type: 'EXPIRED',
      originalTransactionId: receipt,
    }).expect(200);
    expect(repeat.body).toEqual({ duplicate: true });
    const after = await http(ctx.app).get('/v1/me/subscription').set(bearer(viewer.accessToken)).expect(200);
    expect(after.body).toEqual(before.body);
    const events = await ctx.db
      .select()
      .from(providerEvents)
      .where(and(eq(providerEvents.provider, 'fake'), eq(providerEvents.eventId, 'evt-expired-1')));
    expect(events).toHaveLength(1);
    expect(events[0]?.processingStatus).toBe('processed');

    // Stronger: after a renewal, replaying the old EXPIRED event must not take access away again.
    await sendFakeWebhook(ctx.app, { eventId: 'evt-renewed-1', type: 'RENEWED', originalTransactionId: receipt }).expect(200);
    const replay = await sendFakeWebhook(ctx.app, {
      eventId: 'evt-expired-1',
      type: 'EXPIRED',
      originalTransactionId: receipt,
    }).expect(200);
    expect(replay.body).toEqual({ duplicate: true });
    const renewed = await http(ctx.app).get('/v1/me/subscription').set(bearer(viewer.accessToken)).expect(200);
    expect(renewed.body).toMatchObject({ status: 'active', hasAccess: true });
  });

  it('rejects a webhook with a bad signature: 401, nothing stored', async () => {
    const response = await sendFakeWebhook(
      ctx.app,
      { eventId: 'evt-forged', type: 'REVOKED', originalTransactionId: receipt },
      'a'.repeat(64),
    ).expect(401);
    expect(response.body).toEqual({ statusCode: 401, code: 'INVALID_SIGNATURE', message: expect.any(String) });
    const events = await ctx.db.select().from(providerEvents).where(eq(providerEvents.eventId, 'evt-forged'));
    expect(events).toHaveLength(0);
    const view = await http(ctx.app).get('/v1/me/subscription').set(bearer(viewer.accessToken)).expect(200);
    expect(view.body).toMatchObject({ hasAccess: true });
  });

  it('serves the manifest only for an untampered, unexpired signed URL', async () => {
    // Earlier premium sessions were revoked; end the remaining one so a slot is free.
    await http(ctx.app).delete(`/v1/playback/sessions/${premiumSessions[1]}`).set(bearer(viewer.accessToken)).expect(204);
    const session = await startPlayback(SEED_IDS.freeLesson2).expect(201);
    freeSessionManifest = (session.body as PlaybackAuthorizationBody).manifestUrl;

    const ok = await http(ctx.app).get(pathOf(freeSessionManifest)).set('Origin', 'http://localhost:3002').expect(302);
    expect(ok.headers.location).toBe(process.env.FAKE_SAMPLE_MANIFEST_URL);
    // Usable by the web player on the viewer website.
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:3002');
    expect(ok.headers['cross-origin-resource-policy']).toBe('cross-origin');

    const url = new URL(freeSessionManifest);
    const sig = url.searchParams.get('sig') ?? '';
    const tampered = new URL(freeSessionManifest);
    tampered.searchParams.set('sig', `${sig[0] === '0' ? '1' : '0'}${sig.slice(1)}`);
    const badSig = await http(ctx.app).get(pathOf(tampered.toString())).expect(401);
    expect(badSig.body.code).toBe('INVALID_SIGNATURE');

    const otherSession = new URL(freeSessionManifest);
    otherSession.searchParams.set('sid', randomUUID());
    await http(ctx.app).get(pathOf(otherSession.toString())).expect(401);

    // Correctly signed but already expired.
    const pastExp = Math.floor(Date.now() / 1000) - 10;
    const sid = url.searchParams.get('sid') ?? '';
    const expiredSig = hmacHex(
      process.env.FAKE_MEDIA_SIGNING_SECRET ?? '',
      `GET ${url.pathname}?sid=${sid}&exp=${pastExp}`,
    );
    const expired = await http(ctx.app).get(`${url.pathname}?sid=${sid}&exp=${pastExp}&sig=${expiredSig}`).expect(401);
    expect(expired.body.code).toBe('INVALID_SIGNATURE');

    await http(ctx.app)
      .delete(`/v1/playback/sessions/${(session.body as PlaybackAuthorizationBody).playbackSessionId}`)
      .set(bearer(viewer.accessToken))
      .expect(204);
  });

  it('forbids viewers on admin routes: 403 FORBIDDEN', async () => {
    const response = await http(ctx.app).get('/v1/admin/content').set(bearer(viewer.accessToken)).expect(403);
    expect(response.body).toEqual({ statusCode: 403, code: 'FORBIDDEN', message: expect.any(String) });
    await http(ctx.app).get('/v1/admin/content').expect(401);
  });

  describe('admin publishing and playback revocation through heartbeats', () => {
    let admin: TestUser;
    let lessonId: string;

    it('creates a lesson, refuses to publish before upload, publishes after upload', async () => {
      admin = await loginAdmin(ctx.app);
      const created = await http(ctx.app)
        .post('/v1/admin/content')
        .set(bearer(admin.accessToken))
        .send({
          kind: 'lesson',
          title: 'New free lesson',
          description: 'Uploaded in the e2e test',
          accessTier: 'free',
          defaultLanguage: 'en',
          parentId: SEED_IDS.freeCourse,
          position: 3,
          regions: ['in'],
        })
        .expect(201);
      expect(created.body).toMatchObject({
        kind: 'lesson',
        publicationStatus: 'draft',
        parentId: SEED_IDS.freeCourse,
        regions: ['IN'],
        asset: null,
      });
      lessonId = (created.body as { id: string }).id;

      const early = await http(ctx.app).post(`/v1/admin/content/${lessonId}/publish`).set(bearer(admin.accessToken)).expect(409);
      expect(early.body.code).toBe('ASSET_NOT_READY');

      const upload = await http(ctx.app)
        .post(`/v1/admin/content/${lessonId}/upload-session`)
        .set(bearer(admin.accessToken))
        .expect(201);
      const uploadBody = upload.body as { videoAssetId: string; uploadUrl: string; method: string; headers: object };
      expect(uploadBody.method).toBe('PUT');
      expect(uploadBody.uploadUrl).toMatch(/^http:\/\/localhost:3000\/v1\/dev\/media\/uploads\/[^?]+\?exp=\d+&sig=[0-9a-f]{64}$/);

      // Still not ready until the file is uploaded.
      await http(ctx.app).post(`/v1/admin/content/${lessonId}/publish`).set(bearer(admin.accessToken)).expect(409);

      const tamperedUpload = uploadBody.uploadUrl.replace(/exp=(\d+)/, (_m, exp: string) => `exp=${Number(exp) + 60}`);
      await http(ctx.app).put(pathOf(tamperedUpload)).set('Content-Type', 'video/mp4').send(Buffer.from('x')).expect(401);

      await http(ctx.app)
        .put(pathOf(uploadBody.uploadUrl))
        .set('Content-Type', 'video/mp4')
        .send(Buffer.from('not really a video'))
        .expect(200);

      const published = await http(ctx.app).post(`/v1/admin/content/${lessonId}/publish`).set(bearer(admin.accessToken)).expect(200);
      expect(published.body).toMatchObject({
        publicationStatus: 'published',
        asset: { id: uploadBody.videoAssetId, processingStatus: 'ready' },
      });

      const publicView = await http(ctx.app).get(`/v1/content/${lessonId}`).expect(200);
      expect(publicView.body).toMatchObject({ id: lessonId, playable: true, parentId: SEED_IDS.freeCourse });

      const actions = (
        await ctx.db.select({ action: auditLogs.action }).from(auditLogs).where(eq(auditLogs.targetId, lessonId))
      ).map((row) => row.action);
      expect(actions).toEqual(
        expect.arrayContaining(['content.create', 'content.upload_session.create', 'content.publish']),
      );
    });

    it('unpublishing during playback ends the session at the next heartbeat (404 NOT_FOUND)', async () => {
      const session = await startPlayback(lessonId).expect(201);
      const sessionId = (session.body as PlaybackAuthorizationBody).playbackSessionId;
      await heartbeat(sessionId).expect(200);

      await http(ctx.app).post(`/v1/admin/content/${lessonId}/unpublish`).set(bearer(admin.accessToken)).expect(200);
      const beat = await heartbeat(sessionId).expect(404);
      expect(beat.body.code).toBe('NOT_FOUND');
      const [row] = await ctx.db.select().from(playbackSessions).where(eq(playbackSessions.id, sessionId));
      expect(row).toMatchObject({ revokeReason: 'NOT_FOUND' });
      expect(row?.revokedAt).not.toBeNull();
      expect((await heartbeat(sessionId).expect(403)).body.code).toBe('PLAYBACK_SESSION_ENDED');
    });

    it('removing the region during playback ends the session (403 REGION_NOT_ALLOWED)', async () => {
      await http(ctx.app).post(`/v1/admin/content/${lessonId}/publish`).set(bearer(admin.accessToken)).expect(200);
      const session = await startPlayback(lessonId).expect(201);
      const sessionId = (session.body as PlaybackAuthorizationBody).playbackSessionId;

      const patched = await http(ctx.app)
        .patch(`/v1/admin/content/${lessonId}`)
        .set(bearer(admin.accessToken))
        .send({ regions: ['US'] })
        .expect(200);
      expect(patched.body).toMatchObject({ regions: ['US'], publicationStatus: 'published' });

      const beat = await heartbeat(sessionId).expect(403);
      expect(beat.body.code).toBe('REGION_NOT_ALLOWED');
      expect((await heartbeat(sessionId).expect(403)).body.code).toBe('PLAYBACK_SESSION_ENDED');
    });
  });

  it('rotates refresh tokens and revokes the family when an old token is reused', async () => {
    const first = await http(ctx.app).post('/v1/auth/refresh').send({ refreshToken: viewer.refreshToken }).expect(200);
    const rotated = (first.body as { tokens: { accessToken: string; refreshToken: string } }).tokens;
    expect(rotated.refreshToken).not.toBe(viewer.refreshToken);
    await http(ctx.app).get('/v1/me').set(bearer(rotated.accessToken)).expect(200);

    const reuse = await http(ctx.app).post('/v1/auth/refresh').send({ refreshToken: viewer.refreshToken }).expect(401);
    expect(reuse.body.code).toBe('INVALID_REFRESH_TOKEN');

    // The whole family is gone: the rotated token and its access token stop working too.
    const afterReuse = await http(ctx.app).post('/v1/auth/refresh').send({ refreshToken: rotated.refreshToken }).expect(401);
    expect(afterReuse.body.code).toBe('INVALID_REFRESH_TOKEN');
    const me = await http(ctx.app).get('/v1/me').set(bearer(rotated.accessToken)).expect(401);
    expect(me.body.code).toBe('UNAUTHENTICATED');

    viewer = await login(ctx.app, viewer.email, viewer.password);
  });

  it('logout makes the access token stop working immediately', async () => {
    const session = await login(ctx.app, viewer.email, viewer.password);
    await http(ctx.app).get('/v1/me').set(bearer(session.accessToken)).expect(200);
    await http(ctx.app).post('/v1/auth/logout').send({ refreshToken: session.refreshToken }).expect(204);
    const me = await http(ctx.app).get('/v1/me').set(bearer(session.accessToken)).expect(401);
    expect(me.body.code).toBe('UNAUTHENTICATED');
    await http(ctx.app).post('/v1/auth/refresh').send({ refreshToken: session.refreshToken }).expect(401);
    // The other login session is unaffected.
    await http(ctx.app).get('/v1/me').set(bearer(viewer.accessToken)).expect(200);
  });

  it("revoking a device ends that device's playback", async () => {
    const session = await startPlayback(SEED_IDS.freeLesson1).expect(201);
    const sessionId = (session.body as PlaybackAuthorizationBody).playbackSessionId;
    await http(ctx.app).delete(`/v1/me/devices/${deviceId}`).set(bearer(viewer.accessToken)).expect(204);

    expect((await heartbeat(sessionId).expect(403)).body.code).toBe('PLAYBACK_SESSION_ENDED');
    expect((await startPlayback(SEED_IDS.freeLesson1).expect(403)).body.code).toBe('DEVICE_REVOKED');
    const reRegister = await http(ctx.app)
      .post('/v1/me/devices')
      .set(bearer(viewer.accessToken))
      .send({ installationId, platform: 'android', name: 'Again' })
      .expect(403);
    expect(reRegister.body.code).toBe('DEVICE_REVOKED');
    const list = await http(ctx.app).get('/v1/me/devices').set(bearer(viewer.accessToken)).expect(200);
    expect(list.body).toEqual([]);
  });

  it('DELETE /v1/me soft-deletes the account and blocks further login', async () => {
    const tokenBefore = viewer.accessToken;
    await http(ctx.app).delete('/v1/me').set(bearer(viewer.accessToken)).expect(204);
    const loginAttempt = await http(ctx.app)
      .post('/v1/auth/login')
      .send({ email: viewer.email, password: viewer.password })
      .expect(403);
    expect(loginAttempt.body.code).toBe('ACCOUNT_INACTIVE');
    await http(ctx.app).get('/v1/me').set(bearer(tokenBefore)).expect(401);
    await http(ctx.app).post('/v1/auth/refresh').send({ refreshToken: viewer.refreshToken }).expect(401);
  });
});
