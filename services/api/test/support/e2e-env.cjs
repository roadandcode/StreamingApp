/**
 * Environment for the end-to-end tests. Runs before each test file is loaded.
 *
 * The tests truncate every table, so they only ever use a database whose name ends in `_test`
 * (TEST_DATABASE_URL, default streaming_test). DATABASE_URL from the shell is deliberately ignored.
 */
const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ?? 'postgres://streaming:streaming@localhost:5432/streaming_test';

const databaseName = new URL(testDatabaseUrl).pathname.replace(/^\//, '');
if (!databaseName.endsWith('_test')) {
  throw new Error(`Refusing to run e2e tests against "${databaseName}": the database name must end in _test`);
}

Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: testDatabaseUrl,
  JWT_ACCESS_SECRET: 'e2e-test-jwt-secret-that-is-long-enough-0123456789',
  ACCESS_TOKEN_TTL_SECONDS: '900',
  REFRESH_TOKEN_TTL_DAYS: '30',
  CORS_ORIGINS: 'http://localhost:3001',
  DEFAULT_COUNTRY_CODE: 'IN',
  TRUSTED_COUNTRY_HEADER: 'x-test-viewer-country',
  MAX_DEVICES: '3',
  MAX_CONCURRENT_STREAMS: '2',
  PLAYBACK_AUTH_TTL_SECONDS: '300',
  PLAYBACK_HEARTBEAT_INTERVAL_SECONDS: '30',
  PUBLIC_API_BASE_URL: 'http://localhost:3000',
  MEDIA_PROVIDER: 'fake',
  FAKE_MEDIA_SIGNING_SECRET: 'e2e-fake-media-signing-secret',
  FAKE_SAMPLE_MANIFEST_URL: 'https://test-streams.example.test/sample/master.m3u8',
  BILLING_MODE: 'fake',
  FAKE_WEBHOOK_SECRET: 'e2e-fake-webhook-secret',
  THROTTLE_AUTH_LIMIT: '10000',
  THROTTLE_AUTH_TTL_SECONDS: '60',
  THROTTLE_PLAYBACK_LIMIT: '10000',
  THROTTLE_PLAYBACK_TTL_SECONDS: '60',
  SEED_ADMIN_EMAIL: 'admin@e2e.test',
  SEED_ADMIN_PASSWORD: 'e2e-admin-password',
});
