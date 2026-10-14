import { timingSafeEqual } from 'node:crypto';

/** Constant-time comparison of two hex HMAC-SHA256 signatures; false for anything malformed. */
export function signaturesMatch(expectedHex: string, presented: unknown): boolean {
  if (typeof presented !== 'string' || !/^[0-9a-f]{64}$/i.test(presented)) return false;
  const a = Buffer.from(expectedHex, 'hex');
  const b = Buffer.from(presented.toLowerCase(), 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
