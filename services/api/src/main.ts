import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { parseEnv } from './config/env.schema';
import { loadEnvFile } from './database/load-env-file';

async function bootstrap(): Promise<void> {
  loadEnvFile();
  // Validate before building the app: provider selection depends on it, and a bad config must
  // stop the process (fake providers in production, short JWT secret, missing fake secrets).
  const env = parseEnv(process.env);
  const app = await NestFactory.create<NestExpressApplication>(AppModule.register(env), {
    rawBody: true,
    bufferLogs: true,
  });
  configureApp(app, env);
  await app.listen(env.PORT);
  Logger.log(
    `API listening on port ${env.PORT} (media: ${env.MEDIA_PROVIDER}, billing: ${env.BILLING_MODE}, env: ${env.APP_ENV})`,
    'Bootstrap',
  );
}

bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
