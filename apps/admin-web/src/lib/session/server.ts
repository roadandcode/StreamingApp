import "server-only";

import { getIronSession, type IronSession } from "iron-session";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionOptions, isActiveAdminSession, type AdminSessionData } from "./config";

/** Header the proxy sets with the path being rendered, used to come back after signing in. */
export const CURRENT_PATH_HEADER = "x-admin-path";

/**
 * The session bound to the current request's cookies. Saving or destroying it only works in
 * server actions and route handlers; server components must treat it as read-only.
 */
export async function getSession(): Promise<IronSession<AdminSessionData>> {
  return getIronSession<AdminSessionData>(await cookies(), getSessionOptions());
}

/** The signed-in admin, or `null`. Read-only; safe in server components. */
export async function getAdminSession(): Promise<AdminSessionData | null> {
  const session = await getSession();
  return isActiveAdminSession(session) ? session : null;
}

/** Only accepts same-site relative paths, so `?next=` can never redirect off-site. */
export function safeNextPath(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return null;
  }
  if (value.startsWith("/login") || value.startsWith("/auth/")) {
    return null;
  }
  return value;
}

export async function currentPath(): Promise<string> {
  return safeNextPath((await headers()).get(CURRENT_PATH_HEADER)) ?? "/content";
}

export function loginPath(reason?: "expired" | "signed-out", next?: string | null): string {
  const params = new URLSearchParams();
  if (reason) params.set("reason", reason);
  if (next && next !== "/content") params.set("next", next);
  const query = params.toString();
  return query ? `/login?${query}` : "/login";
}

/** Redirects to the login page unless an admin is signed in. */
export async function requireAdminSession(): Promise<AdminSessionData> {
  const session = await getAdminSession();
  if (!session) {
    redirect(loginPath(undefined, await currentPath()));
  }
  return session;
}
