import { describe, expect, it, vi } from "vitest";
import type { DrmConfig } from "@/lib/api/types";
import { buildPlayerSetup, createLicenseRequestFilter, detectSupportedDrm, PROBE_CONFIGS } from "./drm";

const options = { requireDrm: false, maxVideoHeight: 720 };

describe("buildPlayerSetup", () => {
  it("configures Widevine with the licence server and passes the licence headers through unchanged", () => {
    const drm: DrmConfig = {
      system: "widevine",
      licenseUrl: "https://license.example.com/widevine",
      certificateUrl: null,
      licenseRequestHeaders: { "x-vendor-auth": "short-lived-token", "x-vendor-session": "abc" },
    };
    const setup = buildPlayerSetup(drm, options);
    expect(setup).toEqual({
      ok: true,
      config: {
        drm: {
          servers: { "com.widevine.alpha": "https://license.example.com/widevine" },
          preferredKeySystems: ["com.widevine.alpha"],
        },
        restrictions: { maxHeight: 720 },
        abr: { restrictions: { maxHeight: 720 } },
      },
      licenseRequestHeaders: { "x-vendor-auth": "short-lived-token", "x-vendor-session": "abc" },
    });
  });

  it("configures FairPlay with its server certificate", () => {
    const drm: DrmConfig = {
      system: "fairplay",
      licenseUrl: "https://license.example.com/fairplay",
      certificateUrl: "https://license.example.com/fairplay.cer",
      licenseRequestHeaders: { authorization: "Bearer abc" },
    };
    const setup = buildPlayerSetup(drm, { requireDrm: true, maxVideoHeight: 1080 });
    expect(setup.ok).toBe(true);
    if (!setup.ok) return;
    expect(setup.config.drm).toEqual({
      servers: { "com.apple.fps": "https://license.example.com/fairplay" },
      preferredKeySystems: ["com.apple.fps"],
      advanced: { "com.apple.fps": { serverCertificateUri: "https://license.example.com/fairplay.cer" } },
    });
    expect(setup.config.restrictions.maxHeight).toBe(1080);
    expect(setup.licenseRequestHeaders).toEqual({ authorization: "Bearer abc" });
  });

  it("uses the PlayReady key system name Shaka expects", () => {
    const setup = buildPlayerSetup(
      { system: "playready", licenseUrl: "https://l.example/pr", certificateUrl: null, licenseRequestHeaders: {} },
      options,
    );
    expect(setup.ok && setup.config.drm?.servers).toEqual({ "com.microsoft.playready": "https://l.example/pr" });
  });

  it("plays unprotected streams when DRM is not required", () => {
    expect(buildPlayerSetup(null, options)).toEqual({
      ok: true,
      config: { restrictions: { maxHeight: 720 }, abr: { restrictions: { maxHeight: 720 } } },
      licenseRequestHeaders: null,
    });
  });

  it("refuses drm: null when DRM is required", () => {
    expect(buildPlayerSetup(null, { requireDrm: true, maxVideoHeight: 720 })).toEqual({ ok: false, code: "DRM_REQUIRED" });
  });

  it("does not share the header object with the authorization", () => {
    const headers = { "x-token": "a" };
    const setup = buildPlayerSetup(
      { system: "widevine", licenseUrl: "https://l.example/wv", certificateUrl: null, licenseRequestHeaders: headers },
      options,
    );
    expect(setup.ok && setup.licenseRequestHeaders).not.toBe(headers);
  });
});

describe("createLicenseRequestFilter", () => {
  const LICENSE = 2;
  const SEGMENT = 1;

  it("adds the headers to licence requests only", () => {
    const filter = createLicenseRequestFilter(LICENSE, { "x-token": "t1" });
    const license = { headers: { "content-type": "application/octet-stream" } as Record<string, string> };
    const segment = { headers: {} as Record<string, string> };
    filter(LICENSE, license);
    filter(SEGMENT, segment);
    expect(license.headers).toEqual({ "content-type": "application/octet-stream", "x-token": "t1" });
    expect(segment.headers).toEqual({});
  });
});

describe("detectSupportedDrm", () => {
  it("returns nothing when EME is unavailable", async () => {
    await expect(detectSupportedDrm(undefined)).resolves.toEqual([]);
  });

  it("reports Widevine when only Widevine is supported", async () => {
    const access = vi.fn(async (keySystem: string) => {
      if (keySystem === "com.widevine.alpha") return {};
      throw new DOMException("Unsupported keySystem", "NotSupportedError");
    });
    await expect(detectSupportedDrm(access)).resolves.toEqual(["widevine"]);
    expect(access).toHaveBeenCalledWith("com.widevine.alpha", PROBE_CONFIGS.widevine);
  });

  it("reports several systems in a stable order and tries alternate key-system names", async () => {
    const supported = new Set(["com.apple.fps.1_0", "com.microsoft.playready", "com.widevine.alpha"]);
    const access = vi.fn(async (keySystem: string) => {
      if (supported.has(keySystem)) return {};
      throw new Error("NotSupportedError");
    });
    await expect(detectSupportedDrm(access)).resolves.toEqual(["widevine", "playready", "fairplay"]);
    expect(access).toHaveBeenCalledWith("com.microsoft.playready.recommendation", PROBE_CONFIGS.playready);
    expect(access).toHaveBeenCalledWith("com.apple.fps", PROBE_CONFIGS.fairplay);
  });

  it("detects FairPlay on Safari", async () => {
    const access = vi.fn(async (keySystem: string) => {
      if (keySystem === "com.apple.fps") return {};
      throw new Error("NotSupportedError");
    });
    await expect(detectSupportedDrm(access)).resolves.toEqual(["fairplay"]);
  });

  it("treats a synchronous throw or a hanging probe as unsupported", async () => {
    vi.useFakeTimers();
    try {
      const access = vi.fn((keySystem: string) => {
        if (keySystem === "com.widevine.alpha") return new Promise(() => undefined);
        throw new TypeError("blocked by policy");
      });
      const result = detectSupportedDrm(access, { timeoutMs: 1000 });
      await vi.advanceTimersByTimeAsync(1001);
      await expect(result).resolves.toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
