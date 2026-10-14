import "server-only";
import { cookies } from "next/headers";
import { getConfig } from "@/lib/config";
import {
  INSTALLATION_COOKIE,
  SESSION_COOKIE,
  installationCookieOptions,
  isUuid,
  sealSession,
  sessionCookieOptions,
  unsealSession,
  type SessionData,
} from "./codec";

/** Reads and decrypts the session cookie. Works everywhere on the server, including server components. */
export async function readSession(): Promise<SessionData | null> {
  const store = await cookies();
  return unsealSession(store.get(SESSION_COOKIE)?.value, getConfig().sessionCookieSecret);
}

/** Encrypts and stores the session. Only route handlers and server actions may call this. */
export async function writeSession(data: SessionData): Promise<void> {
  const config = getConfig();
  const store = await cookies();
  store.set(SESSION_COOKIE, await sealSession(data, config.sessionCookieSecret), sessionCookieOptions(data, config.isProduction));
}

/** Removes the session cookie (sign-out). Keeps the browser's installation id. */
export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/** This browser's device installation id, if one was generated before. */
export async function readInstallationId(): Promise<string | null> {
  const store = await cookies();
  const value = store.get(INSTALLATION_COOKIE)?.value;
  return isUuid(value) ? value : null;
}

/** Returns this browser's installation id, generating and storing one on first use. */
export async function ensureInstallationId(): Promise<string> {
  const existing = await readInstallationId();
  if (existing) return existing;
  const id = crypto.randomUUID();
  const store = await cookies();
  store.set(INSTALLATION_COOKIE, id, installationCookieOptions(getConfig().isProduction));
  return id;
}
