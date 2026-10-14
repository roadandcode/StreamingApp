import "server-only";
import { headers } from "next/headers";
import { getConfig } from "@/lib/config";
import { accessTokenNeedsRefresh, type SessionData } from "@/lib/session/codec";
import { clearSession, readSession, writeSession } from "@/lib/session/server";
import { refreshSessionTokens } from "@/lib/session/tokens";
import { requestApi, type RequestOptions } from "./client";
import { ApiError, defaultMessageForCode } from "./errors";

/**
 * Server-only access to the API. Three entry points:
 *
 * - {@link publicGet}: anonymous, cacheable reads (catalog, content, plans).
 * - {@link renderApiFetch}: authenticated reads from server components. Server components cannot
 *   set cookies, so this never refreshes tokens; `proxy.ts` refreshes them before rendering.
 * - {@link ApiSession}: route handlers and server actions. Refreshes once on expiry or on
 *   `401 UNAUTHENTICATED` and persists the rotated tokens in the encrypted cookie.
 */

type CallOptions = Omit<RequestOptions, "accessToken" | "revalidate">;

async function forwardedHeaders(): Promise<Record<string, string>> {
  const { trustedCountryHeader } = getConfig();
  if (!trustedCountryHeader) return {};
  const value = (await headers()).get(trustedCountryHeader);
  return value && /^[A-Za-z]{2}$/.test(value) ? { [trustedCountryHeader]: value.toUpperCase() } : {};
}

function unauthenticated(): ApiError {
  return new ApiError(401, "UNAUTHENTICATED", defaultMessageForCode("UNAUTHENTICATED"));
}

export async function publicGet<T>(path: string, revalidate = 60): Promise<T> {
  return requestApi<T>(getConfig().apiBaseUrl, path, { revalidate, headers: await forwardedHeaders() });
}

/** Anonymous, uncached call (sign-in, registration). */
export async function anonymousFetch<T>(path: string, options: CallOptions = {}): Promise<T> {
  return requestApi<T>(getConfig().apiBaseUrl, path, {
    ...options,
    headers: { ...(await forwardedHeaders()), ...options.headers },
  });
}

export async function renderApiFetch<T>(path: string, options: CallOptions = {}): Promise<T> {
  const session = await readSession();
  if (!session) throw unauthenticated();
  return requestApi<T>(getConfig().apiBaseUrl, path, {
    ...options,
    accessToken: session.tokens.accessToken,
    headers: { ...(await forwardedHeaders()), ...options.headers },
  });
}

export class ApiSession {
  private constructor(private current: SessionData | null) {}

  static async load(): Promise<ApiSession> {
    return new ApiSession(await readSession());
  }

  get data(): SessionData | null {
    return this.current;
  }

  /** Authenticated call; refreshes the access token when needed and persists rotated tokens. */
  async fetch<T>(path: string, options: CallOptions = {}): Promise<T> {
    if (!this.current) throw unauthenticated();
    if (accessTokenNeedsRefresh(this.current)) await this.refresh();

    const call = async () =>
      requestApi<T>(getConfig().apiBaseUrl, path, {
        ...options,
        accessToken: this.current!.tokens.accessToken,
        headers: { ...(await forwardedHeaders()), ...options.headers },
      });

    try {
      return await call();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401 && error.code === "UNAUTHENTICATED") {
        await this.refresh();
        return call();
      }
      throw error;
    }
  }

  /** Replaces the session (sign-in) and persists it. */
  async save(next: SessionData): Promise<void> {
    this.current = next;
    await writeSession(next);
  }

  async update(patch: Partial<Pick<SessionData, "deviceId">>): Promise<void> {
    if (!this.current) return;
    await this.save({ ...this.current, ...patch });
  }

  async clear(): Promise<void> {
    this.current = null;
    await clearSession();
  }

  private async refresh(): Promise<void> {
    const session = this.current;
    if (!session) throw unauthenticated();
    try {
      const tokens = await refreshSessionTokens(getConfig().apiBaseUrl, session.tokens.refreshToken);
      await this.save({ ...session, tokens });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        await this.clear();
        throw unauthenticated();
      }
      throw error;
    }
  }
}
