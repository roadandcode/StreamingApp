import { createHmac } from 'node:crypto';
import { signaturesMatch } from '../common/signatures';

/**
 * URL signing for the fake media provider (development and tests only).
 *
 * `sig` is the hex HMAC-SHA256, keyed with FAKE_MEDIA_SIGNING_SECRET, of a canonical string made of
 * the HTTP method, the path and the signed query parameters in a fixed order, for example
 * `GET /v1/dev/media/{id}/manifest.m3u8?sid={sid}&exp={exp}`. `exp` is a unix time in seconds.
 */
export const FAKE_UPLOAD_PATH_PREFIX = '/v1/dev/media/uploads';
export const FAKE_MEDIA_PATH_PREFIX = '/v1/dev/media';

export function uploadPath(providerAssetId: string): string {
  return `${FAKE_UPLOAD_PATH_PREFIX}/${encodeURIComponent(providerAssetId)}`;
}

export function manifestPath(providerAssetId: string): string {
  return `${FAKE_MEDIA_PATH_PREFIX}/${encodeURIComponent(providerAssetId)}/manifest.m3u8`;
}

function uploadCanonical(providerAssetId: string, exp: number): string {
  return `PUT ${uploadPath(providerAssetId)}?exp=${exp}`;
}

function manifestCanonical(providerAssetId: string, sessionId: string, exp: number): string {
  return `GET ${manifestPath(providerAssetId)}?sid=${encodeURIComponent(sessionId)}&exp=${exp}`;
}

export function hmacHex(secret: string, message: string): string {
  return createHmac('sha256', secret).update(message, 'utf8').digest('hex');
}

function parseExp(raw: unknown): number | null {
  if (typeof raw !== 'string' || !/^\d{1,12}$/.test(raw)) return null;
  return Number(raw);
}

const nowSeconds = (now: Date) => Math.floor(now.getTime() / 1000);

export function signUploadUrl(baseUrl: string, secret: string, providerAssetId: string, exp: number): string {
  const sig = hmacHex(secret, uploadCanonical(providerAssetId, exp));
  return `${baseUrl}${uploadPath(providerAssetId)}?exp=${exp}&sig=${sig}`;
}

export function signManifestUrl(
  baseUrl: string,
  secret: string,
  providerAssetId: string,
  sessionId: string,
  exp: number,
): string {
  const sig = hmacHex(secret, manifestCanonical(providerAssetId, sessionId, exp));
  return `${baseUrl}${manifestPath(providerAssetId)}?sid=${encodeURIComponent(sessionId)}&exp=${exp}&sig=${sig}`;
}

export function verifyUploadUrl(
  secret: string,
  providerAssetId: string,
  query: { exp?: unknown; sig?: unknown },
  now: Date,
): boolean {
  const exp = parseExp(query.exp);
  if (exp === null) return false;
  const valid = signaturesMatch(hmacHex(secret, uploadCanonical(providerAssetId, exp)), query.sig);
  return valid && exp > nowSeconds(now);
}

export function verifyManifestUrl(
  secret: string,
  providerAssetId: string,
  query: { sid?: unknown; exp?: unknown; sig?: unknown },
  now: Date,
): boolean {
  const exp = parseExp(query.exp);
  if (exp === null || typeof query.sid !== 'string' || query.sid.length === 0) return false;
  const valid = signaturesMatch(hmacHex(secret, manifestCanonical(providerAssetId, query.sid, exp)), query.sig);
  return valid && exp > nowSeconds(now);
}
