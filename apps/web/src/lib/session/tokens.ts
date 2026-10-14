import { refreshTokensAtApi } from "@/lib/api/client";
import type { Tokens } from "@/lib/api/types";
import { createRefreshCoordinator } from "./refresh";

const COORDINATOR = Symbol.for("streamingapp.web.refreshCoordinator");

type Coordinator = ReturnType<typeof createRefreshCoordinator>;

/** Process-wide, de-duplicated `POST /v1/auth/refresh`. */
export function refreshSessionTokens(apiBaseUrl: string, refreshToken: string): Promise<Tokens> {
  const holder = globalThis as typeof globalThis & { [COORDINATOR]?: Coordinator };
  holder[COORDINATOR] ??= createRefreshCoordinator((token) => refreshTokensAtApi(apiBaseUrl, token));
  return holder[COORDINATOR](refreshToken);
}
