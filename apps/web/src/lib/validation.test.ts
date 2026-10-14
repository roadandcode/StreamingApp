import { describe, expect, it } from "vitest";
import { safeNextPath } from "./navigation";
import { parseHeartbeatBody, parseStartPlaybackBody } from "./player/validation";

describe("safeNextPath", () => {
  it.each([
    ["/watch/1b4e28ba-2fa1-4d2a-883f-0016d3cca427", "/watch/1b4e28ba-2fa1-4d2a-883f-0016d3cca427"],
    ["/subscribe?plan=premium_monthly", "/subscribe?plan=premium_monthly"],
    ["https://evil.example/", "/"],
    ["//evil.example/", "/"],
    ["/\\evil.example", "/"],
    ["javascript:alert(1)", "/"],
    ["", "/"],
  ])("%s → %s", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });

  it("ignores non-strings", () => {
    expect(safeNextPath(null)).toBe("/");
    expect(safeNextPath(undefined, "/account")).toBe("/account");
  });
});

describe("playback request validation", () => {
  const contentId = "1b4e28ba-2fa1-4d2a-883f-0016d3cca427";

  it("keeps only known DRM systems, once each", () => {
    expect(parseStartPlaybackBody({ contentId, supportedDrm: ["widevine", "widevine", "clearkey", 3] })).toEqual({
      contentId,
      supportedDrm: ["widevine"],
    });
    expect(parseStartPlaybackBody({ contentId })).toEqual({ contentId, supportedDrm: [] });
  });

  it("rejects bad content ids and shapes", () => {
    expect(parseStartPlaybackBody({ contentId: "../../admin" })).toBeNull();
    expect(parseStartPlaybackBody({ contentId, supportedDrm: "widevine" })).toBeNull();
    expect(parseStartPlaybackBody(null)).toBeNull();
  });

  it("accepts an optional, sane heartbeat position", () => {
    expect(parseHeartbeatBody(undefined)).toEqual({});
    expect(parseHeartbeatBody({ positionSeconds: 12.7 })).toEqual({ positionSeconds: 12 });
    expect(parseHeartbeatBody({ positionSeconds: -1 })).toBeNull();
    expect(parseHeartbeatBody({ positionSeconds: "12" })).toBeNull();
  });
});
