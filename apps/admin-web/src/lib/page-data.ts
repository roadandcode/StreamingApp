import "server-only";

import { notFound } from "next/navigation";
import { describeApiError, isApiError } from "./api/errors";

export type PageErrorKind = "forbidden" | "network" | "other";

export interface PageError {
  kind: PageErrorKind;
  message: string;
}

export type PageData<T> = { ok: true; data: T } | { ok: false; error: PageError };

/**
 * Runs a page's API reads. `404` renders the not-found page; `403`, network failures and other
 * API errors come back as a `PageError` for the page to show. Redirects (for example to the
 * login page) and unexpected exceptions propagate.
 */
export async function loadPageData<T>(load: () => Promise<T>): Promise<PageData<T>> {
  try {
    return { ok: true, data: await load() };
  } catch (error) {
    if (!isApiError(error)) {
      throw error;
    }
    if (error.code === "NOT_FOUND") {
      notFound();
    }
    const kind: PageErrorKind =
      error.code === "FORBIDDEN" ? "forbidden" : error.code === "NETWORK_ERROR" ? "network" : "other";
    return { ok: false, error: { kind, message: describeApiError(error) } };
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export type SearchParams = Record<string, string | string[] | undefined>;

export function firstParam(params: SearchParams, key: string): string | undefined {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

export function pageParam(params: SearchParams): number {
  const value = Number.parseInt(firstParam(params, "page") ?? "1", 10);
  return Number.isFinite(value) && value >= 1 ? value : 1;
}
