import 'reflect-metadata';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { configureApp } from '../app.setup';
import { parseEnv } from '../config/env.schema';
import { buildOpenApiDocument } from './openapi';

/** Where the contract package expects the spec. */
export const OPENAPI_OUTPUT = resolve(__dirname, '../../../../packages/api-contracts/openapi.json');

/**
 * Builds the OpenAPI document without listening or touching the database, and writes it to
 * packages/api-contracts/openapi.json. Uses the development configuration (fake providers), so the
 * fake webhook route is included; placeholder secrets are used because nothing is signed.
 */
async function main(): Promise<void> {
  const env = parseEnv({
    NODE_ENV: 'development',
    JWT_ACCESS_SECRET: 'openapi-emit-placeholder-secret-not-used-for-signing',
    MEDIA_PROVIDER: 'fake',
    BILLING_MODE: 'fake',
    FAKE_MEDIA_SIGNING_SECRET: 'openapi-emit-placeholder',
    FAKE_WEBHOOK_SECRET: 'openapi-emit-placeholder',
  });
  // AppConfigModule validates process.env, so give it the same placeholder configuration.
  Object.assign(process.env, {
    NODE_ENV: env.NODE_ENV,
    JWT_ACCESS_SECRET: env.JWT_ACCESS_SECRET,
    MEDIA_PROVIDER: env.MEDIA_PROVIDER,
    BILLING_MODE: env.BILLING_MODE,
    FAKE_MEDIA_SIGNING_SECRET: env.FAKE_MEDIA_SIGNING_SECRET,
    FAKE_WEBHOOK_SECRET: env.FAKE_WEBHOOK_SECRET,
  });
  const app = await NestFactory.create(AppModule.register(env, { requestLogging: false }), {
    logger: ['error', 'warn'],
    rawBody: true,
  });
  configureApp(app, env, { swaggerUi: false });
  const document = buildOpenApiDocument(app);
  mkdirSync(dirname(OPENAPI_OUTPUT), { recursive: true });
  writeFileSync(OPENAPI_OUTPUT, `${JSON.stringify(document, null, 2)}\n`);
  await app.close();
  console.log(`OpenAPI document written to ${OPENAPI_OUTPUT}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
