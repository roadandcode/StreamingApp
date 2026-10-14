import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getTableName, sql } from 'drizzle-orm';
import { isTable } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { signFakeWebhookBody } from '../../src/billing/fake-billing-verifier';
import { parseEnv } from '../../src/config/env.schema';
import { createDatabase, createPool } from '../../src/database/connection';
import type { Database } from '../../src/database/database.types';
import { runMigrations } from '../../src/database/migrate';
import * as schema from '../../src/database/schema';
import { seedDatabase } from '../../src/database/seed-data';

export { SEED_IDS } from '../../src/database/seed-data';

export interface TestContext {
  app: INestApplication<App>;
  db: Database;
  close(): Promise<void>;
}

/** Migrates the test database, empties every table and loads the seed. */
export async function resetDatabase(options: { razorpayPlanIds?: { monthly?: string; yearly?: string } } = {}): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url || !/_test(\?|$)/.test(url)) {
    throw new Error('resetDatabase only runs against a *_test database');
  }
  await runMigrations(url);
  const pool = createPool(url);
  try {
    const db = createDatabase(pool);
    const tables = Object.values(schema)
      .filter((value) => isTable(value))
      .map((table) => `"${getTableName(table)}"`);
    await db.execute(sql.raw(`truncate table ${tables.join(', ')} restart identity cascade`));
    await seedDatabase(db, {
      adminEmail: process.env.SEED_ADMIN_EMAIL,
      adminPassword: process.env.SEED_ADMIN_PASSWORD,
      razorpayPlanIds: options.razorpayPlanIds,
    });
  } finally {
    await pool.end();
  }
}

/**
 * Builds the app exactly like main.ts (same module, same global setup) with optional environment
 * overrides; the previous environment is restored on close.
 */
export async function createTestApp(
  overrides: Record<string, string | undefined> = {},
  providers: Array<{ token: unknown; value: unknown }> = [],
): Promise<TestContext> {
  const saved = { ...process.env };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const env = parseEnv(process.env);
  let builder = Test.createTestingModule({
    imports: [AppModule.register(env, { requestLogging: false })],
  });
  for (const provider of providers) {
    builder = builder.overrideProvider(provider.token).useValue(provider.value);
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>({ rawBody: true, logger: ['error'] });
  configureApp(app, env, { swaggerUi: false });
  await app.init();
  const pool = createPool(env.DATABASE_URL);
  return {
    app,
    db: createDatabase(pool),
    async close() {
      await app.close();
      await pool.end();
      process.env = saved;
    },
  };
}

export function http(app: INestApplication<App>) {
  return request(app.getHttpServer());
}

export function bearer(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

export interface TestUser {
  id: string;
  email: string;
  password: string;
  accessToken: string;
  refreshToken: string;
}

export async function registerUser(app: INestApplication<App>, prefix = 'viewer'): Promise<TestUser> {
  const email = `${prefix}-${randomUUID().slice(0, 8)}@e2e.test`;
  const password = 'correct-horse-battery';
  const response = await http(app).post('/v1/auth/register').send({ email, password }).expect(201);
  const body = response.body as { user: { id: string }; tokens: { accessToken: string; refreshToken: string } };
  return {
    id: body.user.id,
    email,
    password,
    accessToken: body.tokens.accessToken,
    refreshToken: body.tokens.refreshToken,
  };
}

export async function login(app: INestApplication<App>, email: string, password: string): Promise<TestUser> {
  const response = await http(app).post('/v1/auth/login').send({ email, password }).expect(200);
  const body = response.body as { user: { id: string }; tokens: { accessToken: string; refreshToken: string } };
  return { id: body.user.id, email, password, accessToken: body.tokens.accessToken, refreshToken: body.tokens.refreshToken };
}

export async function loginAdmin(app: INestApplication<App>): Promise<TestUser> {
  return login(app, process.env.SEED_ADMIN_EMAIL ?? '', process.env.SEED_ADMIN_PASSWORD ?? '');
}

export async function registerDevice(
  app: INestApplication<App>,
  user: TestUser,
  installationId: string = randomUUID(),
): Promise<string> {
  const response = await http(app)
    .post('/v1/me/devices')
    .set(bearer(user.accessToken))
    .send({ installationId, platform: 'android', name: 'Test phone' })
    .expect(201);
  return (response.body as { id: string }).id;
}

/** Sends a fake store notification signed with FAKE_WEBHOOK_SECRET (or a given signature). */
export function sendFakeWebhook(
  app: INestApplication<App>,
  event: Record<string, unknown>,
  signature?: string,
) {
  const body = JSON.stringify(event);
  return http(app)
    .post('/v1/webhooks/fake')
    .set('Content-Type', 'application/json')
    .set('X-Fake-Signature', signature ?? signFakeWebhookBody(process.env.FAKE_WEBHOOK_SECRET ?? '', body))
    .send(body);
}

/** Path and query of an absolute URL returned by the API (fake media URLs). */
export function pathOf(url: string): string {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}
