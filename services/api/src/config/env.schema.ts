import { z } from 'zod';

const int = (fallback: number, min: number, max: number) =>
  z.coerce.number().int().min(min).max(max).default(fallback);

const url = (fallback: string) =>
  z
    .url({ protocol: /^https?$/ })
    .default(fallback)
    .transform((value) => value.replace(/\/+$/, ''));

export const DEFAULT_SAMPLE_MANIFEST_URL = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';

/**
 * Environment variables of the API (see docs/architecture/api-contract.md). The app refuses to start
 * when validation fails; error messages name the variable but never echo its value.
 */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    /**
     * Deployment environment. Defaults to NODE_ENV. With NODE_ENV=production it may only be
     * `production` (the default) or `staging`; fake providers are refused only in `production`.
     */
    APP_ENV: z.enum(['development', 'test', 'staging', 'production']).optional(),
    PORT: int(3000, 1, 65535),
    DATABASE_URL: z
      .string()
      .regex(/^postgres(ql)?:\/\//, 'must be a postgres:// connection string')
      .default('postgres://streaming:streaming@localhost:5432/streaming_dev'),
    JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters'),
    ACCESS_TOKEN_TTL_SECONDS: int(900, 60, 86_400),
    REFRESH_TOKEN_TTL_DAYS: int(30, 1, 365),
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:3001,http://localhost:3002')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter((origin) => origin.length > 0),
      ),
    DEFAULT_COUNTRY_CODE: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/, 'must be an ISO-3166 alpha-2 code')
      .default('IN'),
    TRUSTED_COUNTRY_HEADER: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9-]+$/, 'must be an HTTP header name')
      .optional(),
    MAX_DEVICES: int(3, 1, 100),
    MAX_CONCURRENT_STREAMS: int(2, 1, 100),
    PLAYBACK_AUTH_TTL_SECONDS: int(300, 30, 86_400),
    PLAYBACK_HEARTBEAT_INTERVAL_SECONDS: int(30, 5, 3_600),
    PUBLIC_API_BASE_URL: url('http://localhost:3000'),
    MEDIA_PROVIDER: z.enum(['fake', 'aws']).default('fake'),
    FAKE_MEDIA_SIGNING_SECRET: z.string().min(16, 'must be at least 16 characters').optional(),
    FAKE_SAMPLE_MANIFEST_URL: url(DEFAULT_SAMPLE_MANIFEST_URL),
    BILLING_MODE: z.enum(['fake', 'live']).default('fake'),
    FAKE_WEBHOOK_SECRET: z.string().min(16, 'must be at least 16 characters').optional(),
    RAZORPAY_KEY_ID: z.string().trim().min(1).optional(),
    RAZORPAY_KEY_SECRET: z.string().min(1).optional(),
    RAZORPAY_WEBHOOK_SECRET: z.string().min(1).optional(),
    THROTTLE_AUTH_LIMIT: int(10, 1, 1_000_000),
    THROTTLE_AUTH_TTL_SECONDS: int(60, 1, 86_400),
    THROTTLE_PLAYBACK_LIMIT: int(60, 1, 1_000_000),
    THROTTLE_PLAYBACK_TTL_SECONDS: int(60, 1, 86_400),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.APP_ENV && !['staging', 'production'].includes(env.APP_ENV)) {
      ctx.addIssue({
        code: 'custom',
        path: ['APP_ENV'],
        message: 'must be staging or production when NODE_ENV=production',
      });
    }
    if (resolveAppEnv(env) === 'production') {
      if (env.MEDIA_PROVIDER === 'fake') {
        ctx.addIssue({
          code: 'custom',
          path: ['MEDIA_PROVIDER'],
          message: 'the fake media provider is not allowed when APP_ENV=production',
        });
      }
      if (env.BILLING_MODE === 'fake') {
        ctx.addIssue({
          code: 'custom',
          path: ['BILLING_MODE'],
          message: 'fake billing is not allowed when APP_ENV=production',
        });
      }
    }
    if (env.MEDIA_PROVIDER === 'fake' && !env.FAKE_MEDIA_SIGNING_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['FAKE_MEDIA_SIGNING_SECRET'],
        message: 'is required when MEDIA_PROVIDER=fake',
      });
    }
    if (env.BILLING_MODE === 'fake' && !env.FAKE_WEBHOOK_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['FAKE_WEBHOOK_SECRET'],
        message: 'is required when BILLING_MODE=fake',
      });
    }
    if (env.PLAYBACK_AUTH_TTL_SECONDS <= env.PLAYBACK_HEARTBEAT_INTERVAL_SECONDS) {
      ctx.addIssue({
        code: 'custom',
        path: ['PLAYBACK_AUTH_TTL_SECONDS'],
        message: 'must be longer than PLAYBACK_HEARTBEAT_INTERVAL_SECONDS',
      });
    }
  })
  .transform((env) => ({ ...env, APP_ENV: resolveAppEnv(env) }));

export type Env = z.output<typeof envSchema>;
export type AppEnv = Env['APP_ENV'];

function resolveAppEnv(env: {
  NODE_ENV: 'development' | 'test' | 'production';
  APP_ENV?: 'development' | 'test' | 'staging' | 'production';
}): 'development' | 'test' | 'staging' | 'production' {
  return env.APP_ENV ?? env.NODE_ENV;
}

/**
 * Validates raw environment variables. Empty strings count as unset so that `FOO=` in a .env file
 * falls back to the default. Throws an Error listing every problem.
 */
export function parseEnv(raw: Record<string, unknown>): Env {
  const cleaned = Object.fromEntries(
    Object.entries(raw).filter(([, value]) => value !== undefined && value !== ''),
  );
  const result = envSchema.safeParse(cleaned);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'} ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  return result.data;
}

/** Fake providers and the /v1/dev/* routes are only ever mounted outside APP_ENV=production. */
export function isFakeMediaEnabled(env: Pick<Env, 'MEDIA_PROVIDER' | 'APP_ENV'>): boolean {
  return env.MEDIA_PROVIDER === 'fake' && env.APP_ENV !== 'production';
}

export function isFakeBillingEnabled(env: Pick<Env, 'BILLING_MODE' | 'APP_ENV'>): boolean {
  return env.BILLING_MODE === 'fake' && env.APP_ENV !== 'production';
}

/** Razorpay web checkout needs all three credentials; otherwise its endpoints fail closed (503). */
export function isRazorpayConfigured(
  env: Pick<Env, 'RAZORPAY_KEY_ID' | 'RAZORPAY_KEY_SECRET' | 'RAZORPAY_WEBHOOK_SECRET'>,
): boolean {
  return Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET && env.RAZORPAY_WEBHOOK_SECRET);
}
