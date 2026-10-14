import { randomBytes, scrypt, type ScryptOptions, timingSafeEqual } from 'node:crypto';

/**
 * Password hashing with node:crypto scrypt (no native dependencies).
 * Stored format: `scrypt$<N>$<r>$<p>$<salt base64url>$<hash base64url>`.
 */
const PARAMS = { N: 16_384, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;

function scryptAsync(password: string, salt: Buffer, keyLength: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, keyLength, options, (error, derived) => {
      if (error) reject(error);
      else resolve(derived);
    });
  });
}

function maxmem(N: number, r: number): number {
  // scrypt needs ~128 * N * r bytes; leave headroom over Node's 32 MiB default.
  return 256 * N * r + 1024 * 1024;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const { N, r, p } = PARAMS;
  const derived = await scryptAsync(password, salt, KEY_LENGTH, { N, r, p, maxmem: maxmem(N, r) });
  return ['scrypt', N, r, p, salt.toString('base64url'), derived.toString('base64url')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    return false;
  }
  const [, nRaw, rRaw, pRaw, saltRaw, hashRaw] = parts as [string, string, string, string, string, string];
  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (![N, r, p].every((value) => Number.isInteger(value) && value > 0)) {
    return false;
  }
  const expected = Buffer.from(hashRaw, 'base64url');
  if (expected.length === 0) {
    return false;
  }
  const derived = await scryptAsync(password, Buffer.from(saltRaw, 'base64url'), expected.length, {
    N,
    r,
    p,
    maxmem: maxmem(N, r),
  });
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/**
 * A valid hash of a random password, used to spend the same time on unknown emails as on known
 * ones so login timing does not reveal which emails are registered.
 */
let dummyHash: Promise<string> | undefined;
export function getDummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(32).toString('hex'));
  return dummyHash;
}
