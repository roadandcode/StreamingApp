import { hashPassword, verifyPassword } from './password';

describe('password hashing', () => {
  it('verifies the right password and rejects a wrong one', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(hash.startsWith('scrypt$16384$8$1$')).toBe(true);
    await expect(verifyPassword('correct horse battery', hash)).resolves.toBe(true);
    await expect(verifyPassword('correct horse batterz', hash)).resolves.toBe(false);
  });

  it('salts every hash', async () => {
    const [a, b] = await Promise.all([hashPassword('same password!'), hashPassword('same password!')]);
    expect(a).not.toBe(b);
  });

  it('rejects malformed stored hashes', async () => {
    await expect(verifyPassword('whatever1234', 'not-a-hash')).resolves.toBe(false);
    await expect(verifyPassword('whatever1234', 'scrypt$x$8$1$abc$def')).resolves.toBe(false);
    await expect(verifyPassword('whatever1234', 'scrypt$16384$8$1$abc$')).resolves.toBe(false);
  });
});
