import type { AccessTier, AccountStatus } from '../database/schema';
import { type AccessResult, tierSatisfies } from '../entitlements/compute-access';

export type PlaybackDenialCode =
  | 'ACCOUNT_INACTIVE'
  | 'NOT_FOUND'
  | 'REGION_NOT_ALLOWED'
  | 'CONTENT_NOT_PLAYABLE'
  | 'ENTITLEMENT_REQUIRED'
  | 'DEVICE_NOT_REGISTERED'
  | 'DEVICE_REVOKED'
  | 'CONCURRENT_STREAM_LIMIT';

export interface PlaybackContentFacts {
  /** The item is published (and so is its parent course, if it has one). */
  published: boolean;
  /** Licensed for the viewer's country right now. */
  availableInCountry: boolean;
  /** Has a video asset in `ready` state. */
  hasReadyAsset: boolean;
  accessTier: AccessTier;
}

export interface PlaybackDeviceFacts {
  ownedByCaller: boolean;
  revoked: boolean;
}

export interface PlaybackFacts {
  accountStatus: AccountStatus;
  /** `null` when the content does not exist. */
  content: PlaybackContentFacts | null;
  entitlement: AccessResult;
  /** `null` when the device id is unknown. */
  device: PlaybackDeviceFacts | null;
  /** Active sessions of the caller: not ended or revoked, heartbeat within the stale window. */
  activeSessionCount: number;
  maxConcurrentStreams: number;
}

export type PolicyResult = { ok: true } | { ok: false; code: PlaybackDenialCode };

type Check = (facts: PlaybackFacts) => PlaybackDenialCode | null;

/** 1. Account active. */
const accountActive: Check = (f) => (f.accountStatus === 'active' ? null : 'ACCOUNT_INACTIVE');

/** 2. Content exists, is published and is available in the viewer's country. */
const contentVisible: Check = (f) => {
  if (!f.content || !f.content.published) return 'NOT_FOUND';
  if (!f.content.availableInCountry) return 'REGION_NOT_ALLOWED';
  return null;
};

/** 3. Content has a ready video asset. */
const contentPlayable: Check = (f) => (f.content?.hasReadyAsset ? null : 'CONTENT_NOT_PLAYABLE');

/** 4. Premium content needs an active entitlement. */
const entitled: Check = (f) => {
  const required = f.content?.accessTier ?? 'premium';
  if (required === 'free') return null;
  return f.entitlement.hasAccess && tierSatisfies(f.entitlement.accessTier, required) ? null : 'ENTITLEMENT_REQUIRED';
};

/** 5. Device belongs to the caller and is not revoked. */
const deviceUsable: Check = (f) => {
  if (!f.device || !f.device.ownedByCaller) return 'DEVICE_NOT_REGISTERED';
  if (f.device.revoked) return 'DEVICE_REVOKED';
  return null;
};

/** 6. Under the concurrent-stream limit. */
const underStreamLimit: Check = (f) =>
  f.activeSessionCount < f.maxConcurrentStreams ? null : 'CONCURRENT_STREAM_LIMIT';

function run(checks: readonly Check[], facts: PlaybackFacts): PolicyResult {
  for (const check of checks) {
    const code = check(facts);
    if (code) return { ok: false, code };
  }
  return { ok: true };
}

const NEW_SESSION_CHECKS = [accountActive, contentVisible, contentPlayable, entitled, deviceUsable, underStreamLimit];
const HEARTBEAT_CHECKS = [accountActive, contentVisible, entitled, deviceUsable];

/** Checks for `POST /v1/playback/sessions`, in contract order; the first failure wins. */
export function evaluateNewSession(facts: PlaybackFacts): PolicyResult {
  return run(NEW_SESSION_CHECKS, facts);
}

/** Checks re-run on every heartbeat (1, 2, 4 and 5); concurrency and asset are not re-checked. */
export function evaluateHeartbeat(
  facts: Omit<PlaybackFacts, 'activeSessionCount' | 'maxConcurrentStreams'>,
): PolicyResult {
  return run(HEARTBEAT_CHECKS, { ...facts, activeSessionCount: 0, maxConcurrentStreams: 1 });
}
