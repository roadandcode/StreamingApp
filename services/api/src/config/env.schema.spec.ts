import { parseEnv } from './env.schema';

const base = {
  JWT_ACCESS_SECRET: 'x'.repeat(32),
  FAKE_MEDIA_SIGNING_SECRET: 'media-secret-0123456789',
  FAKE_WEBHOOK_SECRET: 'webhook-secret-0123456789',
};

describe('parseEnv', () => {
  it('applies the documented defaults', () => {
    const env = parseEnv(base);
    expect(env).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3000,
      ACCESS_TOKEN_TTL_SECONDS: 900,
      REFRESH_TOKEN_TTL_DAYS: 30,
      CORS_ORIGINS: ['http://localhost:3001'],
      DEFAULT_COUNTRY_CODE: 'IN',
      MAX_DEVICES: 3,
      MAX_CONCURRENT_STREAMS: 2,
      PLAYBACK_AUTH_TTL_SECONDS: 300,
      PLAYBACK_HEARTBEAT_INTERVAL_SECONDS: 30,
      PUBLIC_API_BASE_URL: 'http://localhost:3000',
      MEDIA_PROVIDER: 'fake',
      BILLING_MODE: 'fake',
    });
    expect(env.TRUSTED_COUNTRY_HEADER).toBeUndefined();
    expect(env.RAZORPAY_KEY_ID).toBeUndefined();
  });

  it('requires a JWT secret of at least 32 characters', () => {
    expect(() => parseEnv({ ...base, JWT_ACCESS_SECRET: 'short' })).toThrow(/JWT_ACCESS_SECRET/);
    expect(() => parseEnv({ ...base, JWT_ACCESS_SECRET: undefined })).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('never echoes secret values in errors', () => {
    expect(() => parseEnv({ ...base, JWT_ACCESS_SECRET: 'super-secret-value' })).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('super-secret-value') as string }) as Error,
    );
  });

  it('refuses fake providers in production', () => {
    expect(() => parseEnv({ ...base, NODE_ENV: 'production', BILLING_MODE: 'live' })).toThrow(/MEDIA_PROVIDER/);
    expect(() => parseEnv({ ...base, NODE_ENV: 'production', MEDIA_PROVIDER: 'aws' })).toThrow(/BILLING_MODE/);
    expect(parseEnv({ ...base, NODE_ENV: 'production', MEDIA_PROVIDER: 'aws', BILLING_MODE: 'live' })).toMatchObject(
      { NODE_ENV: 'production' },
    );
  });

  it('requires the fake secrets only when the fake modes are on', () => {
    expect(() => parseEnv({ ...base, FAKE_MEDIA_SIGNING_SECRET: '' })).toThrow(/FAKE_MEDIA_SIGNING_SECRET/);
    expect(() => parseEnv({ ...base, FAKE_WEBHOOK_SECRET: undefined })).toThrow(/FAKE_WEBHOOK_SECRET/);
    expect(
      parseEnv({ JWT_ACCESS_SECRET: base.JWT_ACCESS_SECRET, MEDIA_PROVIDER: 'aws', BILLING_MODE: 'live' }),
    ).toMatchObject({ MEDIA_PROVIDER: 'aws', BILLING_MODE: 'live' });
  });

  it('normalizes list, country and header values', () => {
    const env = parseEnv({
      ...base,
      CORS_ORIGINS: 'http://a.test, http://b.test ,',
      DEFAULT_COUNTRY_CODE: 'us',
      TRUSTED_COUNTRY_HEADER: 'CloudFront-Viewer-Country',
      PUBLIC_API_BASE_URL: 'https://api.example.test/',
    });
    expect(env.CORS_ORIGINS).toEqual(['http://a.test', 'http://b.test']);
    expect(env.DEFAULT_COUNTRY_CODE).toBe('US');
    expect(env.TRUSTED_COUNTRY_HEADER).toBe('cloudfront-viewer-country');
    expect(env.PUBLIC_API_BASE_URL).toBe('https://api.example.test');
  });
});
