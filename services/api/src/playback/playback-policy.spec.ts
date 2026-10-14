import { evaluateHeartbeat, evaluateNewSession, type PlaybackFacts } from './playback-policy';

/** Facts under which a premium session is allowed; each test breaks one or more of them. */
function allowed(overrides: Partial<PlaybackFacts> = {}): PlaybackFacts {
  return {
    accountStatus: 'active',
    content: { published: true, availableInCountry: true, hasReadyAsset: true, accessTier: 'premium' },
    entitlement: { hasAccess: true, accessTier: 'premium' },
    device: { ownedByCaller: true, revoked: false },
    activeSessionCount: 0,
    maxConcurrentStreams: 2,
    ...overrides,
  };
}

const noEntitlement = { hasAccess: false, accessTier: null } as const;

describe('evaluateNewSession', () => {
  it('allows a fully valid premium request', () => {
    expect(evaluateNewSession(allowed())).toEqual({ ok: true });
  });

  it('allows free content without an entitlement', () => {
    const facts = allowed({
      content: { published: true, availableInCountry: true, hasReadyAsset: true, accessTier: 'free' },
      entitlement: noEntitlement,
    });
    expect(evaluateNewSession(facts)).toEqual({ ok: true });
  });

  it.each<[string, Partial<PlaybackFacts>, string]>([
    ['suspended account', { accountStatus: 'suspended' }, 'ACCOUNT_INACTIVE'],
    ['deleted account', { accountStatus: 'deleted' }, 'ACCOUNT_INACTIVE'],
    ['missing content', { content: null }, 'NOT_FOUND'],
    [
      'unpublished content',
      { content: { published: false, availableInCountry: true, hasReadyAsset: true, accessTier: 'premium' } },
      'NOT_FOUND',
    ],
    [
      'content outside the viewer country',
      { content: { published: true, availableInCountry: false, hasReadyAsset: true, accessTier: 'premium' } },
      'REGION_NOT_ALLOWED',
    ],
    [
      'content without a ready asset',
      { content: { published: true, availableInCountry: true, hasReadyAsset: false, accessTier: 'premium' } },
      'CONTENT_NOT_PLAYABLE',
    ],
    ['premium content without entitlement', { entitlement: noEntitlement }, 'ENTITLEMENT_REQUIRED'],
    [
      'premium content with a free-tier entitlement',
      { entitlement: { hasAccess: true, accessTier: 'free' } },
      'ENTITLEMENT_REQUIRED',
    ],
    ['unknown device', { device: null }, 'DEVICE_NOT_REGISTERED'],
    ["another user's device", { device: { ownedByCaller: false, revoked: false } }, 'DEVICE_NOT_REGISTERED'],
    ['revoked device', { device: { ownedByCaller: true, revoked: true } }, 'DEVICE_REVOKED'],
    ['too many active sessions', { activeSessionCount: 2 }, 'CONCURRENT_STREAM_LIMIT'],
  ])('denies %s', (_name, overrides, code) => {
    expect(evaluateNewSession(allowed(overrides))).toEqual({ ok: false, code });
  });

  it('allows one session below the limit', () => {
    expect(evaluateNewSession(allowed({ activeSessionCount: 1 }))).toEqual({ ok: true });
  });

  describe('check order (first failure wins)', () => {
    const everythingWrong = allowed({
      accountStatus: 'suspended',
      content: { published: true, availableInCountry: false, hasReadyAsset: false, accessTier: 'premium' },
      entitlement: noEntitlement,
      device: { ownedByCaller: true, revoked: true },
      activeSessionCount: 5,
    });

    it('reports the account before anything else', () => {
      expect(evaluateNewSession(everythingWrong)).toEqual({ ok: false, code: 'ACCOUNT_INACTIVE' });
    });

    it('then content visibility: not found before region', () => {
      expect(
        evaluateNewSession({
          ...everythingWrong,
          accountStatus: 'active',
          content: { published: false, availableInCountry: false, hasReadyAsset: false, accessTier: 'premium' },
        }),
      ).toEqual({ ok: false, code: 'NOT_FOUND' });
      expect(evaluateNewSession({ ...everythingWrong, accountStatus: 'active' })).toEqual({
        ok: false,
        code: 'REGION_NOT_ALLOWED',
      });
    });

    it('then the asset, then the entitlement, then the device, then concurrency', () => {
      const steps: Array<[Partial<PlaybackFacts>, string]> = [
        [
          { content: { published: true, availableInCountry: true, hasReadyAsset: false, accessTier: 'premium' } },
          'CONTENT_NOT_PLAYABLE',
        ],
        [
          { content: { published: true, availableInCountry: true, hasReadyAsset: true, accessTier: 'premium' } },
          'ENTITLEMENT_REQUIRED',
        ],
        [{ entitlement: { hasAccess: true, accessTier: 'premium' } }, 'DEVICE_REVOKED'],
        [{ device: { ownedByCaller: true, revoked: false } }, 'CONCURRENT_STREAM_LIMIT'],
        [{ activeSessionCount: 1 }, 'ok'],
      ];
      let facts: PlaybackFacts = { ...everythingWrong, accountStatus: 'active' };
      for (const [fix, expected] of steps) {
        facts = { ...facts, ...fix };
        const result = evaluateNewSession(facts);
        expect(result.ok ? 'ok' : result.code).toBe(expected);
      }
    });

    it('checks the entitlement before the device', () => {
      expect(evaluateNewSession(allowed({ entitlement: noEntitlement, device: null }))).toEqual({
        ok: false,
        code: 'ENTITLEMENT_REQUIRED',
      });
    });
  });
});

describe('evaluateHeartbeat', () => {
  it('passes when account, content, entitlement and device are still fine', () => {
    expect(evaluateHeartbeat(allowed())).toEqual({ ok: true });
  });

  it('re-runs checks 1, 2, 4 and 5', () => {
    expect(evaluateHeartbeat(allowed({ accountStatus: 'deleted' }))).toEqual({ ok: false, code: 'ACCOUNT_INACTIVE' });
    expect(
      evaluateHeartbeat(
        allowed({ content: { published: false, availableInCountry: true, hasReadyAsset: true, accessTier: 'premium' } }),
      ),
    ).toEqual({ ok: false, code: 'NOT_FOUND' });
    expect(
      evaluateHeartbeat(
        allowed({ content: { published: true, availableInCountry: false, hasReadyAsset: true, accessTier: 'premium' } }),
      ),
    ).toEqual({ ok: false, code: 'REGION_NOT_ALLOWED' });
    expect(evaluateHeartbeat(allowed({ entitlement: noEntitlement }))).toEqual({
      ok: false,
      code: 'ENTITLEMENT_REQUIRED',
    });
    expect(evaluateHeartbeat(allowed({ device: { ownedByCaller: true, revoked: true } }))).toEqual({
      ok: false,
      code: 'DEVICE_REVOKED',
    });
  });

  it('does not re-check the asset (3) or the stream limit (6)', () => {
    expect(
      evaluateHeartbeat(
        allowed({ content: { published: true, availableInCountry: true, hasReadyAsset: false, accessTier: 'premium' } }),
      ),
    ).toEqual({ ok: true });
    expect(evaluateHeartbeat(allowed({ activeSessionCount: 99 }))).toEqual({ ok: true });
  });
});
