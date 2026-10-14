import type { AppConfig } from '../config/app-config';
import type { Database } from '../database/database.types';
import { FakeMediaProvider } from './fake-media-provider';
import { verifyManifestUrl, verifyUploadUrl } from './fake-media-signing';

const SECRET = 'fake-media-signing-secret-for-tests';
const values: Record<string, string> = {
  FAKE_MEDIA_SIGNING_SECRET: SECRET,
  PUBLIC_API_BASE_URL: 'http://localhost:3000',
};
const config = { get: (key: string) => values[key] } as unknown as AppConfig;

describe('FakeMediaProvider', () => {
  const provider = new FakeMediaProvider(config, {} as Database);

  it('issues a signed manifest URL and never DRM, whatever the client supports', async () => {
    const authorization = await provider.createPlaybackAuthorization({
      providerAssetId: 'fake_asset',
      playbackSessionId: 'session-1',
      platform: 'web',
      ttlSeconds: 300,
      supportedDrm: ['widevine', 'fairplay', 'playready'],
    });
    expect(authorization.drm).toBeNull();
    const url = new URL(authorization.manifestUrl);
    expect(url.pathname).toBe('/v1/dev/media/fake_asset/manifest.m3u8');
    expect(verifyManifestUrl(SECRET, 'fake_asset', Object.fromEntries(url.searchParams), new Date())).toBe(true);
    const ttl = (authorization.expiresAt.getTime() - Date.now()) / 1000;
    expect(ttl).toBeGreaterThan(290);
    expect(ttl).toBeLessThanOrEqual(300);
  });

  it('creates upload sessions with a signed PUT URL and no required headers', async () => {
    const session = await provider.createUploadSession('content-1');
    expect(session).toMatchObject({ method: 'PUT', headers: {} });
    expect(session.providerAssetId).toMatch(/^fake_/);
    const url = new URL(session.uploadUrl);
    expect(verifyUploadUrl(SECRET, session.providerAssetId, Object.fromEntries(url.searchParams), new Date())).toBe(
      true,
    );
  });
});
