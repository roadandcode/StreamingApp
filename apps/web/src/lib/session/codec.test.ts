import { describe, expect, it } from "vitest";
import { accessTokenNeedsRefresh, isUuid, sealSession, sessionFromAuth, unsealSession } from "./codec";

const SECRET = "a-test-secret-that-is-at-least-32-characters";

function session(accessExpiresInMs: number) {
  const now = Date.now();
  return sessionFromAuth(
    {
      id: "6f1c1c55-3c5e-4f3c-9a43-0d1f3e1c2b10",
      email: "viewer@example.com",
      displayName: null,
      role: "viewer",
      accountStatus: "active",
      createdAt: new Date(now).toISOString(),
    },
    {
      accessToken: "access",
      accessTokenExpiresAt: new Date(now + accessExpiresInMs).toISOString(),
      refreshToken: "refresh",
      refreshTokenExpiresAt: new Date(now + 30 * 24 * 3600 * 1000).toISOString(),
    },
  );
}

describe("session cookie codec", () => {
  it("round-trips through the encrypted seal", async () => {
    const data = { ...session(900_000), deviceId: "1b4e28ba-2fa1-4d2a-883f-0016d3cca427" };
    const sealed = await sealSession(data, SECRET);
    expect(sealed).not.toContain("refresh");
    expect(await unsealSession(sealed, SECRET)).toEqual(data);
  });

  it("rejects a seal made with another secret or tampered with", async () => {
    const sealed = await sealSession(session(900_000), SECRET);
    expect(await unsealSession(sealed, "another-secret-that-is-at-least-32-characters")).toBeNull();
    expect(await unsealSession(`${sealed.slice(0, -4)}AAAA`, SECRET)).toBeNull();
    expect(await unsealSession(undefined, SECRET)).toBeNull();
    expect(await unsealSession("garbage", SECRET)).toBeNull();
  });

  it("refreshes access tokens that expire within a minute", () => {
    expect(accessTokenNeedsRefresh(session(10 * 60_000))).toBe(false);
    expect(accessTokenNeedsRefresh(session(30_000))).toBe(true);
    expect(accessTokenNeedsRefresh(session(-1))).toBe(true);
  });

  it("validates installation ids as UUIDs", () => {
    expect(isUuid("1b4e28ba-2fa1-4d2a-883f-0016d3cca427")).toBe(true);
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });
});
