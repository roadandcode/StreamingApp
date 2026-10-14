import type { DrmConfig, DrmSystem } from "@/lib/api/types";

/**
 * Browser DRM support for the web player (Encrypted Media Extensions).
 *
 * Everything here is pure or takes its browser dependencies as arguments, so it can be unit-tested
 * without a browser. The API decides which DRM system to use from the list we report; the player
 * only applies what the playback authorization returns.
 */

/** EME key-system strings to probe for each DRM system, most specific first. */
export const KEY_SYSTEMS: Record<DrmSystem, readonly string[]> = {
  widevine: ["com.widevine.alpha"],
  playready: ["com.microsoft.playready.recommendation", "com.microsoft.playready"],
  fairplay: ["com.apple.fps", "com.apple.fps.1_0"],
};

/** Key system name Shaka Player uses in `drm.servers` / `drm.advanced`. */
export const SHAKA_KEY_SYSTEM: Record<DrmSystem, string> = {
  widevine: "com.widevine.alpha",
  playready: "com.microsoft.playready",
  fairplay: "com.apple.fps",
};

const MP4_AVC = 'video/mp4; codecs="avc1.42E01E"';
const MP4_AAC = 'audio/mp4; codecs="mp4a.40.2"';

/** Minimal configurations used only to ask "does this browser support the key system at all?". */
export const PROBE_CONFIGS: Record<DrmSystem, MediaKeySystemConfiguration[]> = {
  widevine: [
    {
      initDataTypes: ["cenc"],
      videoCapabilities: [{ contentType: MP4_AVC, robustness: "SW_SECURE_CRYPTO" }],
      audioCapabilities: [{ contentType: MP4_AAC, robustness: "SW_SECURE_CRYPTO" }],
    },
  ],
  playready: [
    {
      initDataTypes: ["cenc"],
      videoCapabilities: [{ contentType: MP4_AVC }],
      audioCapabilities: [{ contentType: MP4_AAC }],
    },
  ],
  fairplay: [
    {
      initDataTypes: ["sinf", "skd"],
      videoCapabilities: [{ contentType: MP4_AVC }],
      audioCapabilities: [{ contentType: MP4_AAC }],
    },
  ],
};

/** Order in which supported systems are reported. */
const DETECTION_ORDER: readonly DrmSystem[] = ["widevine", "playready", "fairplay"];

export type RequestMediaKeySystemAccess = (
  keySystem: string,
  configs: MediaKeySystemConfiguration[],
) => Promise<unknown>;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/**
 * Returns the DRM systems this browser's EME implementation supports, in a stable order.
 * Pass `navigator.requestMediaKeySystemAccess` bound to `navigator` (or a mock in tests).
 */
export async function detectSupportedDrm(
  requestAccess: RequestMediaKeySystemAccess | undefined,
  options: { timeoutMs?: number } = {},
): Promise<DrmSystem[]> {
  if (typeof requestAccess !== "function") return [];
  const timeoutMs = options.timeoutMs ?? 3000;

  const results = await Promise.all(
    DETECTION_ORDER.map(async (system) => {
      for (const keySystem of KEY_SYSTEMS[system]) {
        try {
          await withTimeout(Promise.resolve().then(() => requestAccess(keySystem, PROBE_CONFIGS[system])), timeoutMs);
          return system;
        } catch {
          // Not supported (NotSupportedError), blocked by policy, or timed out: try the next name.
        }
      }
      return null;
    }),
  );
  return results.filter((system): system is DrmSystem => system !== null);
}

/** The subset of Shaka Player configuration this app sets. */
export interface PlayerConfig {
  drm?: {
    servers: Record<string, string>;
    preferredKeySystems: string[];
    advanced?: Record<string, { serverCertificateUri: string }>;
  };
  restrictions: { maxHeight: number };
  abr: { restrictions: { maxHeight: number } };
}

export type PlayerSetup =
  | {
      ok: true;
      config: PlayerConfig;
      /** Headers to add to licence requests only (never to manifest or segment requests). */
      licenseRequestHeaders: Record<string, string> | null;
    }
  | { ok: false; code: "DRM_REQUIRED" };

export interface PlayerSetupOptions {
  /** Refuse authorizations without DRM (REQUIRE_DRM). */
  requireDrm: boolean;
  /** WEB_MAX_VIDEO_HEIGHT. */
  maxVideoHeight: number;
}

/**
 * Builds the player configuration for a playback authorization's `drm` field.
 *
 * The resolution cap here only limits which renditions this player picks. The real cap must also be
 * enforced where it cannot be bypassed: in packaging (which renditions exist for web) and in the DRM
 * licence policy (e.g. HD keys only for hardware-backed security levels).
 */
export function buildPlayerSetup(drm: DrmConfig | null, options: PlayerSetupOptions): PlayerSetup {
  const maxHeight = options.maxVideoHeight;
  const base: PlayerConfig = {
    restrictions: { maxHeight },
    abr: { restrictions: { maxHeight } },
  };

  if (drm === null) {
    if (options.requireDrm) return { ok: false, code: "DRM_REQUIRED" };
    return { ok: true, config: base, licenseRequestHeaders: null };
  }

  const keySystem = SHAKA_KEY_SYSTEM[drm.system];
  const config: PlayerConfig = {
    ...base,
    drm: {
      servers: { [keySystem]: drm.licenseUrl },
      preferredKeySystems: [keySystem],
    },
  };
  if (drm.certificateUrl) {
    config.drm!.advanced = { [keySystem]: { serverCertificateUri: drm.certificateUrl } };
  }
  // Header names are vendor-specific: pass every one through exactly as the API returned it.
  return { ok: true, config, licenseRequestHeaders: { ...drm.licenseRequestHeaders } };
}

/**
 * A Shaka request filter that adds the licence headers to licence requests only (never to manifest,
 * segment or certificate requests, which go to the CDN).
 * `licenseRequestType` is `shaka.net.NetworkingEngine.RequestType.LICENSE`.
 */
export function createLicenseRequestFilter(licenseRequestType: number, headers: Record<string, string>) {
  return (type: number, request: { headers: Record<string, string> }): void => {
    if (type !== licenseRequestType) return;
    Object.assign(request.headers, headers);
  };
}
