import type { Tokens } from "@/lib/api/types";

/**
 * Refresh tokens rotate on every use, and presenting an already-rotated token revokes the whole
 * session family (contract: "Refresh-token reuse"). A browser often sends several requests at once
 * with the same cookie (page navigation, heartbeats, beacons), so naive refreshing would make the
 * second request look like token theft and sign the viewer out.
 *
 * This coordinator makes concurrent refreshes of the same token share one API call, and remembers
 * the result briefly so a request that still carries the old cookie gets the new tokens instead of
 * re-presenting the rotated one. It works per server process; running several web instances needs
 * sticky sessions or a reuse grace window in the API (listed as an open contract question).
 */

export type RefreshFn = (refreshToken: string) => Promise<Tokens>;

export interface RefreshCoordinatorOptions {
  /** How long a rotation result is remembered for late requests carrying the old token. */
  recentTtlMs?: number;
  now?: () => number;
}

export function createRefreshCoordinator(doRefresh: RefreshFn, options: RefreshCoordinatorOptions = {}) {
  const recentTtlMs = options.recentTtlMs ?? 30_000;
  const now = options.now ?? Date.now;
  const inflight = new Map<string, Promise<Tokens>>();
  const recent = new Map<string, { tokens: Tokens; at: number }>();

  function prune(): void {
    const cutoff = now() - recentTtlMs;
    for (const [key, entry] of recent) {
      if (entry.at < cutoff) recent.delete(key);
    }
  }

  return function refresh(refreshToken: string): Promise<Tokens> {
    prune();
    const remembered = recent.get(refreshToken);
    if (remembered) return Promise.resolve(remembered.tokens);

    const pending = inflight.get(refreshToken);
    if (pending) return pending;

    const promise = doRefresh(refreshToken)
      .then((tokens) => {
        recent.set(refreshToken, { tokens, at: now() });
        return tokens;
      })
      .finally(() => {
        inflight.delete(refreshToken);
      });
    inflight.set(refreshToken, promise);
    return promise;
  };
}
