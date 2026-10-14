import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { playbackSessions } from '../../src/database/schema';
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
  type TestContext,
  type TestUser,
} from '../support/test-app';

interface AdminContentBody {
  id: string;
  position: number;
  publicationStatus: string;
  ageRating: string | null;
  thumbnailUrl: string | null;
  asset: { id: string; processingStatus: string } | null;
}

describe('content rules, stale sessions and logout (e2e)', () => {
  let ctx: TestContext;
  let admin: TestUser;
  let viewer: TestUser;
  let deviceId: string;

  const createContent = (body: Record<string, unknown>) =>
    http(ctx.app).post('/v1/admin/content').set(bearer(admin.accessToken)).send(body);

  const uploadAndWait = async (contentId: string) => {
    const session = await http(ctx.app)
      .post(`/v1/admin/content/${contentId}/upload-session`)
      .set(bearer(admin.accessToken))
      .expect(201);
    const body = session.body as { uploadUrl: string; headers: Record<string, string>; videoAssetId: string };
    expect(body.headers).toEqual({});
    await http(ctx.app).put(pathOf(body.uploadUrl)).set(body.headers).send('bytes').expect(204);
    return body.videoAssetId;
  };

  const startPlayback = (contentId: string) =>
    http(ctx.app).post('/v1/playback/sessions').set(bearer(viewer.accessToken)).send({ contentId, deviceId });

  const heartbeat = (sessionId: string) =>
    http(ctx.app).post(`/v1/playback/sessions/${sessionId}/heartbeat`).set(bearer(viewer.accessToken)).send({});

  beforeAll(async () => {
    await resetDatabase();
    ctx = await createTestApp();
    admin = await loginAdmin(ctx.app);
    viewer = await registerUser(ctx.app);
    deviceId = await registerDevice(ctx.app, viewer);
  });

  afterAll(async () => {
    await ctx?.close();
  });

  describe('content administration', () => {
    let courseId: string;
    const lessonIds: string[] = [];

    it('appends lessons at the next 0-based position and accepts a thumbnail', async () => {
      const course = await createContent({
        kind: 'course',
        title: 'Draft course',
        description: 'Prepared before release',
        accessTier: 'free',
        defaultLanguage: 'en',
        thumbnailUrl: 'https://cdn.example.test/course.jpg',
        regions: ['IN'],
      }).expect(201);
      courseId = (course.body as AdminContentBody).id;
      expect(course.body).toMatchObject({ thumbnailUrl: 'https://cdn.example.test/course.jpg', position: 2 });

      for (const title of ['First', 'Second', 'Third']) {
        const lesson = await createContent({
          kind: 'lesson',
          title,
          description: '',
          accessTier: 'free',
          defaultLanguage: 'en',
          parentId: courseId,
          regions: ['IN'],
        }).expect(201);
        lessonIds.push((lesson.body as AdminContentBody).id);
      }
      const children = await http(ctx.app)
        .get(`/v1/admin/content?parentId=${courseId}`)
        .set(bearer(admin.accessToken))
        .expect(200);
      expect((children.body as { items: AdminContentBody[] }).items.map((c) => c.position)).toEqual([0, 1, 2]);
    });

    it('lists top-level items only, newest updatedAt first', async () => {
      const list = await http(ctx.app).get('/v1/admin/content').set(bearer(admin.accessToken)).expect(200);
      const ids = (list.body as { items: AdminContentBody[] }).items.map((c) => c.id);
      expect(ids[0]).toBe(courseId);
      expect(ids).toEqual(expect.arrayContaining([SEED_IDS.freeCourse, SEED_IDS.premiumCourse]));
      expect(ids).not.toContain(lessonIds[0]);
      expect(ids).not.toContain(SEED_IDS.freeLesson1);
      expect(list.body).toMatchObject({ total: 3 });

      await http(ctx.app)
        .patch(`/v1/admin/content/${SEED_IDS.premiumCourse}`)
        .set(bearer(admin.accessToken))
        .send({ description: 'Touched' })
        .expect(200);
      const again = await http(ctx.app).get('/v1/admin/content').set(bearer(admin.accessToken)).expect(200);
      expect((again.body as { items: AdminContentBody[] }).items[0]?.id).toBe(SEED_IDS.premiumCourse);
    });

    it('PATCH changes position (ties by createdAt), clears nullable fields and refuses kind/parentId', async () => {
      const moved = await http(ctx.app)
        .patch(`/v1/admin/content/${lessonIds[2]}`)
        .set(bearer(admin.accessToken))
        .send({ position: 0, ageRating: 'U' })
        .expect(200);
      expect(moved.body).toMatchObject({ position: 0, ageRating: 'U' });
      const children = await http(ctx.app)
        .get(`/v1/admin/content?parentId=${courseId}`)
        .set(bearer(admin.accessToken))
        .expect(200);
      // No renumbering: First and Third both have position 0; First was created earlier.
      expect((children.body as { items: AdminContentBody[] }).items.map((c) => c.id)).toEqual([
        lessonIds[0],
        lessonIds[2],
        lessonIds[1],
      ]);

      const cleared = await http(ctx.app)
        .patch(`/v1/admin/content/${courseId}`)
        .set(bearer(admin.accessToken))
        .send({ thumbnailUrl: null, ageRating: null })
        .expect(200);
      expect(cleared.body).toMatchObject({ thumbnailUrl: null, ageRating: null });

      for (const body of [{ kind: 'video' }, { parentId: null }, { title: null }, { thumbnailUrl: 'ftp://x' }]) {
        const response = await http(ctx.app)
          .patch(`/v1/admin/content/${lessonIds[0]}`)
          .set(bearer(admin.accessToken))
          .send(body)
          .expect(400);
        const { code, errors } = response.body as { code: string; errors: Array<{ field: string }> };
        expect(code).toBe('VALIDATION_FAILED');
        expect(errors.length).toBeGreaterThan(0);
        expect(errors.every((error) => error.field === Object.keys(body)[0])).toBe(true);
      }
    });

    it('refuses an upload session for a course', async () => {
      const response = await http(ctx.app)
        .post(`/v1/admin/content/${courseId}/upload-session`)
        .set(bearer(admin.accessToken))
        .expect(400);
      expect(response.body.code).toBe('VALIDATION_FAILED');
    });

    it('shows a lesson to viewers only while the lesson and its course are both published', async () => {
      await uploadAndWait(lessonIds[0]);
      await http(ctx.app).post(`/v1/admin/content/${lessonIds[0]}/publish`).set(bearer(admin.accessToken)).expect(200);

      // Course still a draft: the published lesson is hidden.
      await http(ctx.app).get(`/v1/content/${lessonIds[0]}`).expect(404);
      expect((await startPlayback(lessonIds[0]).expect(404)).body.code).toBe('NOT_FOUND');

      await http(ctx.app).post(`/v1/admin/content/${courseId}/publish`).set(bearer(admin.accessToken)).expect(200);
      await http(ctx.app).get(`/v1/content/${lessonIds[0]}`).expect(200);
      const course = await http(ctx.app).get(`/v1/content/${courseId}`).expect(200);
      expect((course.body as { children: Array<{ id: string }> }).children.map((c) => c.id)).toEqual([lessonIds[0]]);

      // Unpublishing the course ends playback of its lessons at the next heartbeat.
      const session = await startPlayback(lessonIds[0]).expect(201);
      const sessionId = (session.body as { playbackSessionId: string }).playbackSessionId;
      await http(ctx.app).post(`/v1/admin/content/${courseId}/unpublish`).set(bearer(admin.accessToken)).expect(200);
      expect((await heartbeat(sessionId).expect(404)).body.code).toBe('NOT_FOUND');
      await http(ctx.app).get(`/v1/content/${lessonIds[0]}`).expect(404);
      await http(ctx.app).post(`/v1/admin/content/${courseId}/publish`).set(bearer(admin.accessToken)).expect(200);
    });

    it('replaces the single video asset on re-upload; playback waits for the new one', async () => {
      const before = await http(ctx.app).get(`/v1/admin/content/${lessonIds[0]}`).set(bearer(admin.accessToken)).expect(200);
      const oldAssetId = (before.body as AdminContentBody).asset?.id;

      const session = await http(ctx.app)
        .post(`/v1/admin/content/${lessonIds[0]}/upload-session`)
        .set(bearer(admin.accessToken))
        .expect(201);
      const upload = session.body as { uploadUrl: string; videoAssetId: string };
      expect(upload.videoAssetId).not.toBe(oldAssetId);

      const during = await http(ctx.app).get(`/v1/admin/content/${lessonIds[0]}`).set(bearer(admin.accessToken)).expect(200);
      expect(during.body).toMatchObject({
        publicationStatus: 'published',
        asset: { id: upload.videoAssetId, processingStatus: 'awaiting_upload' },
      });
      expect((await http(ctx.app).get(`/v1/content/${lessonIds[0]}`).expect(200)).body).toMatchObject({ playable: false });
      expect((await startPlayback(lessonIds[0]).expect(403)).body.code).toBe('CONTENT_NOT_PLAYABLE');

      await http(ctx.app).put(pathOf(upload.uploadUrl)).send('new bytes').expect(204);
      const ready = await startPlayback(lessonIds[0]).expect(201);
      await http(ctx.app)
        .delete(`/v1/playback/sessions/${(ready.body as { playbackSessionId: string }).playbackSessionId}`)
        .set(bearer(viewer.accessToken))
        .expect(204);
    });
  });

  describe('playback sessions', () => {
    it('a heartbeat after the session went stale returns 403 PLAYBACK_SESSION_ENDED and ends it', async () => {
      const session = await startPlayback(SEED_IDS.freeLesson1).expect(201);
      const sessionId = (session.body as { playbackSessionId: string }).playbackSessionId;
      // No heartbeat for more than 3x the 30 s interval (the app was in the background).
      await ctx.db
        .update(playbackSessions)
        .set({ lastHeartbeatAt: new Date(Date.now() - 91_000) })
        .where(eq(playbackSessions.id, sessionId));

      expect((await heartbeat(sessionId).expect(403)).body.code).toBe('PLAYBACK_SESSION_ENDED');
      const [row] = await ctx.db.select().from(playbackSessions).where(eq(playbackSessions.id, sessionId));
      expect(row?.endedAt).not.toBeNull();
      // A new session is allowed (the stale one no longer counts).
      await startPlayback(SEED_IDS.freeLesson1).expect(201);
    });
  });

  describe('auth', () => {
    it('logout answers 204 for unknown and already-revoked refresh tokens', async () => {
      await http(ctx.app).post('/v1/auth/logout').send({ refreshToken: 'not-a-real-token' }).expect(204);
      const session = await registerUser(ctx.app, 'logout');
      await http(ctx.app).post('/v1/auth/logout').send({ refreshToken: session.refreshToken }).expect(204);
      await http(ctx.app).post('/v1/auth/logout').send({ refreshToken: session.refreshToken }).expect(204);
    });

    it('lists users without an email filter, newest first, honouring pageSize', async () => {
      const latest = await registerUser(ctx.app, `newest-${randomUUID().slice(0, 4)}`);
      const page = await http(ctx.app).get('/v1/admin/users?pageSize=2').set(bearer(admin.accessToken)).expect(200);
      expect(page.body).toMatchObject({ page: 1, pageSize: 2 });
      const items = (page.body as { items: Array<{ user: { id: string } }>; total: number }).items;
      expect(items).toHaveLength(2);
      expect(items[0]?.user.id).toBe(latest.id);
      expect((page.body as { total: number }).total).toBeGreaterThanOrEqual(4);
    });
  });
});
