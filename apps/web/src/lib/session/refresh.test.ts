import { describe, expect, it, vi } from "vitest";
import type { Tokens } from "@/lib/api/types";
import { createRefreshCoordinator } from "./refresh";

function tokens(n: number): Tokens {
  return {
    accessToken: `access-${n}`,
    accessTokenExpiresAt: "2026-11-12T00:15:00.000Z",
    refreshToken: `refresh-${n}`,
    refreshTokenExpiresAt: "2026-12-12T00:00:00.000Z",
  };
}

describe("createRefreshCoordinator", () => {
  it("shares one API call between concurrent refreshes of the same token", async () => {
    let resolve!: (value: Tokens) => void;
    const doRefresh = vi.fn(() => new Promise<Tokens>((r) => (resolve = r)));
    const refresh = createRefreshCoordinator(doRefresh);

    const a = refresh("refresh-0");
    const b = refresh("refresh-0");
    resolve(tokens(1));

    await expect(a).resolves.toEqual(tokens(1));
    await expect(b).resolves.toEqual(tokens(1));
    expect(doRefresh).toHaveBeenCalledTimes(1);
  });

  it("answers a late request carrying the rotated token from memory instead of re-presenting it", async () => {
    let now = 1_000;
    const doRefresh = vi.fn(async () => tokens(1));
    const refresh = createRefreshCoordinator(doRefresh, { recentTtlMs: 30_000, now: () => now });

    await refresh("refresh-0");
    now += 10_000;
    await expect(refresh("refresh-0")).resolves.toEqual(tokens(1));
    expect(doRefresh).toHaveBeenCalledTimes(1);

    now += 30_000;
    await refresh("refresh-0");
    expect(doRefresh).toHaveBeenCalledTimes(2);
  });

  it("does not remember failures", async () => {
    const doRefresh = vi
      .fn<(token: string) => Promise<Tokens>>()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(tokens(2));
    const refresh = createRefreshCoordinator(doRefresh);

    await expect(refresh("refresh-0")).rejects.toThrow("network");
    await expect(refresh("refresh-0")).resolves.toEqual(tokens(2));
    expect(doRefresh).toHaveBeenCalledTimes(2);
  });
});
