import { getServerEnv } from "../env";
import { errorFromResponse, networkError } from "./errors";

const REQUEST_TIMEOUT_MS = 15_000;

export type QueryValue = string | number | boolean | undefined | null;

export interface RawRequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  query?: Record<string, QueryValue>;
  accessToken?: string;
}

export function buildApiUrl(path: string, query?: Record<string, QueryValue>): string {
  const url = new URL(`${getServerEnv().apiBaseUrl}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

/**
 * One HTTP call to the API, without any session handling. Resolves with the parsed JSON body
 * (or `undefined` for 204) and rejects with `ApiError` for every failure, including network
 * errors and timeouts.
 */
export async function rawApiRequest<T>(path: string, options: RawRequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (options.accessToken) {
    headers.Authorization = `Bearer ${options.accessToken}`;
  }

  let response: Response;
  try {
    response = await fetch(buildApiUrl(path, options.query), {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    throw networkError(cause);
  }

  if (!response.ok) {
    throw await errorFromResponse(response);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  if (text.length === 0) {
    return undefined as T;
  }
  return JSON.parse(text) as T;
}
