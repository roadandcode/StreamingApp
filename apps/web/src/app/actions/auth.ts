"use server";

import { redirect } from "next/navigation";
import { asApiError, fieldErrorMap, userMessage } from "@/lib/api/errors";
import { ApiSession, anonymousFetch } from "@/lib/api/server";
import type { AuthResponse } from "@/lib/api/types";
import { registerThisBrowser } from "@/lib/device/register";
import { safeNextPath } from "@/lib/navigation";
import { sessionFromAuth } from "@/lib/session/codec";
import { MIN_PASSWORD_LENGTH, type AuthFormState } from "./auth-state";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function readCredentials(formData: FormData) {
  return {
    email: String(formData.get("email") ?? "").trim().toLowerCase(),
    password: String(formData.get("password") ?? ""),
    next: safeNextPath(formData.get("next")),
  };
}

function failure(error: unknown, email: string): AuthFormState {
  const apiError = asApiError(error);
  const fieldErrors = fieldErrorMap(apiError.fieldErrors);
  return {
    error: Object.keys(fieldErrors).length > 0 ? null : userMessage(apiError.toBody()),
    fieldErrors,
    email,
  };
}

/** Revokes a refresh token at the API (`POST /v1/auth/logout`, always `204`). */
async function revokeRefreshToken(refreshToken: string): Promise<void> {
  try {
    await anonymousFetch("/v1/auth/logout", { method: "POST", body: { refreshToken } });
  } catch {
    // API unreachable: the token still expires on its own; the cookie is cleared either way.
  }
}

/**
 * Stores the tokens in the encrypted cookie, registers this browser as a device and returns where
 * to go next. Device problems never undo the sign-in; they lead to the device page instead.
 */
async function completeSignIn(auth: AuthResponse, next: string): Promise<string> {
  const api = await ApiSession.load();
  const previous = api.data;
  await api.save(sessionFromAuth(auth.user, auth.tokens));
  if (previous && previous.tokens.refreshToken !== auth.tokens.refreshToken) {
    await revokeRefreshToken(previous.tokens.refreshToken);
  }

  const encodedNext = encodeURIComponent(next);
  try {
    const registration = await registerThisBrowser(api);
    if (registration.status === "limit") return `/device?reason=limit&next=${encodedNext}`;
    if (registration.status === "blocked") return `/device?reason=blocked&next=${encodedNext}`;
    return next;
  } catch {
    return `/device?next=${encodedNext}`;
  }
}

export async function signIn(_previous: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const { email, password, next } = readCredentials(formData);
  if (!EMAIL_RE.test(email) || password.length === 0) {
    return { error: "Enter your email address and password.", fieldErrors: {}, email };
  }

  let auth: AuthResponse;
  try {
    auth = await anonymousFetch<AuthResponse>("/v1/auth/login", { method: "POST", body: { email, password } });
  } catch (error) {
    return failure(error, email);
  }
  redirect(await completeSignIn(auth, next));
}

export async function register(_previous: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const { email, password, next } = readCredentials(formData);
  const displayName = String(formData.get("displayName") ?? "").trim();

  const fieldErrors: Record<string, string> = {};
  if (!EMAIL_RE.test(email) || email.length > 254) fieldErrors.email = "Enter a valid email address.";
  if (password.length < MIN_PASSWORD_LENGTH) {
    fieldErrors.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (displayName.length > 80) fieldErrors.displayName = "Keep your name under 80 characters.";
  if (Object.keys(fieldErrors).length > 0) return { error: null, fieldErrors, email };

  let auth: AuthResponse;
  try {
    auth = await anonymousFetch<AuthResponse>("/v1/auth/register", {
      method: "POST",
      body: displayName ? { email, password, displayName } : { email, password },
    });
  } catch (error) {
    return failure(error, email);
  }
  redirect(await completeSignIn(auth, next));
}

export async function signOut(): Promise<void> {
  const api = await ApiSession.load();
  const session = api.data;
  if (session) await revokeRefreshToken(session.tokens.refreshToken);
  await api.clear();
  redirect("/");
}
