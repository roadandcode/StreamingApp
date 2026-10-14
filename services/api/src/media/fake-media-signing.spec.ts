import { signManifestUrl, signUploadUrl, verifyManifestUrl, verifyUploadUrl } from './fake-media-signing';

const SECRET = 'fake-media-signing-secret-for-tests';
const BASE = 'http://localhost:3000';
const now = new Date('2026-11-12T00:00:00.000Z');
const nowSec = Math.floor(now.getTime() / 1000);
const assetId = 'fake_6f0c1d0a-4f7e-4c43-9a51-6a0e2d1c9b10';
const sessionId = '0b7b7d3e-29a4-4c9c-8a1e-2f1f0f3a9c55';

function query(url: string): Record<string, string> {
  return Object.fromEntries(new URL(url).searchParams.entries());
}

describe('fake manifest URLs', () => {
  const exp = nowSec + 300;
  const url = signManifestUrl(BASE, SECRET, assetId, sessionId, exp);

  it('have the contract shape', () => {
    expect(url).toMatch(
      new RegExp(`^${BASE}/v1/dev/media/${assetId}/manifest\\.m3u8\\?sid=${sessionId}&exp=${exp}&sig=[0-9a-f]{64}$`),
    );
  });

  it('verify when untouched and unexpired', () => {
    expect(verifyManifestUrl(SECRET, assetId, query(url), now)).toBe(true);
  });

  it('reject a tampered signature', () => {
    const q = query(url);
    const flipped = (q.sig[0] === 'a' ? 'b' : 'a') + q.sig.slice(1);
    expect(verifyManifestUrl(SECRET, assetId, { ...q, sig: flipped }, now)).toBe(false);
    expect(verifyManifestUrl(SECRET, assetId, { ...q, sig: 'zz' }, now)).toBe(false);
    expect(verifyManifestUrl(SECRET, assetId, { ...q, sig: undefined }, now)).toBe(false);
  });

  it('reject a tampered expiry, session or asset', () => {
    const q = query(url);
    expect(verifyManifestUrl(SECRET, assetId, { ...q, exp: String(exp + 3600) }, now)).toBe(false);
    expect(verifyManifestUrl(SECRET, assetId, { ...q, sid: 'another-session' }, now)).toBe(false);
    expect(verifyManifestUrl(SECRET, 'fake_other', q, now)).toBe(false);
  });

  it('reject a URL signed with another secret', () => {
    const forged = signManifestUrl(BASE, 'some-other-secret-value', assetId, sessionId, exp);
    expect(verifyManifestUrl(SECRET, assetId, query(forged), now)).toBe(false);
  });

  it('reject an expired URL even with a valid signature', () => {
    const expired = signManifestUrl(BASE, SECRET, assetId, sessionId, nowSec - 1);
    expect(verifyManifestUrl(SECRET, assetId, query(expired), now)).toBe(false);
    const atExpiry = signManifestUrl(BASE, SECRET, assetId, sessionId, nowSec);
    expect(verifyManifestUrl(SECRET, assetId, query(atExpiry), now)).toBe(false);
  });

  it('reject a malformed expiry', () => {
    expect(verifyManifestUrl(SECRET, assetId, { ...query(url), exp: '1e12' }, now)).toBe(false);
  });
});

describe('fake upload URLs', () => {
  const exp = nowSec + 3600;
  const url = signUploadUrl(BASE, SECRET, assetId, exp);

  it('have the contract shape and verify', () => {
    expect(url).toMatch(new RegExp(`^${BASE}/v1/dev/media/uploads/${assetId}\\?exp=${exp}&sig=[0-9a-f]{64}$`));
    expect(verifyUploadUrl(SECRET, assetId, query(url), now)).toBe(true);
  });

  it('reject tampering and expiry', () => {
    const q = query(url);
    expect(verifyUploadUrl(SECRET, assetId, { ...q, exp: String(exp + 1) }, now)).toBe(false);
    expect(verifyUploadUrl(SECRET, 'fake_other', q, now)).toBe(false);
    expect(verifyUploadUrl(SECRET, assetId, q, new Date((exp + 1) * 1000))).toBe(false);
  });

  it('cannot be used as a manifest signature', () => {
    const q = query(url);
    expect(verifyManifestUrl(SECRET, assetId, { sid: sessionId, exp: q.exp, sig: q.sig }, now)).toBe(false);
  });
});
