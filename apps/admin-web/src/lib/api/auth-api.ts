import { rawApiRequest } from "./http";
import type { AuthResponse, LoginRequest, RefreshResponse, RefreshTokenRequest, Tokens } from "./types";

/** POST /v1/auth/login */
export function loginWithPassword(credentials: LoginRequest): Promise<AuthResponse> {
  return rawApiRequest<AuthResponse>("/v1/auth/login", { method: "POST", body: credentials });
}

/** POST /v1/auth/refresh — rotates the refresh token. */
export async function refreshTokens(refreshToken: string): Promise<Tokens> {
  const body: RefreshTokenRequest = { refreshToken };
  const result = await rawApiRequest<RefreshResponse>("/v1/auth/refresh", { method: "POST", body });
  return result.tokens;
}

/** POST /v1/auth/logout — revokes the session that owns this refresh token. */
export async function revokeRefreshToken(refreshToken: string): Promise<void> {
  const body: RefreshTokenRequest = { refreshToken };
  await rawApiRequest<void>("/v1/auth/logout", { method: "POST", body });
}
