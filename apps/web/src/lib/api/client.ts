import { ApiError, toApiError } from "./errors";
import type { RefreshResponse, Tokens } from "./types";

/**
 * Low-level HTTP client for the API. Runtime-agnostic (used by server code and by the proxy);
 * the browser never calls the API directly.
 *
 * Never log request URLs that carry signed parameters, tokens or response bodies.
 */

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  accessToken?: string;
  /** Extra headers, e.g. the forwarded viewer-country header. */
  headers?: Record<string, string>;
  /**
   * Cache a public GET in the Next data cache for this many seconds. Authenticated requests are
   * never cached.
   */
  revalidate?: number;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export async function requestApi<T>(baseUrl: string, path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, accessToken, revalidate, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  const headers: Record<string, string> = { accept: "application/json", ...options.headers };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;

  const cacheable = method === "GET" && !accessToken && revalidate !== undefined && revalidate > 0;
  const init: RequestInit & { next?: { revalidate: number } } = {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  };
  if (cacheable) {
    // No abort signal here: a signal opts the request out of request memoization.
    init.next = { revalidate };
  } else {
    init.cache = "no-store";
    init.signal = AbortSignal.timeout(timeoutMs);
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, init);
  } catch {
    throw new ApiError(503, "NETWORK_ERROR", "The API could not be reached.");
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let parsed: unknown = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
  }

  if (!response.ok) throw toApiError(response.status, parsed);
  return parsed as T;
}

/** `POST /v1/auth/refresh`: rotates the refresh token. */
export async function refreshTokensAtApi(baseUrl: string, refreshToken: string): Promise<Tokens> {
  const result = await requestApi<RefreshResponse>(baseUrl, "/v1/auth/refresh", {
    method: "POST",
    body: { refreshToken },
  });
  return result.tokens;
}
