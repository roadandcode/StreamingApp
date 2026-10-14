"use server";

import { redirect } from "next/navigation";
import { loginWithPassword, revokeRefreshToken } from "@/lib/api/auth-api";
import { isApiError } from "@/lib/api/errors";
import type { AuthResponse } from "@/lib/api/types";
import { applyTokens, sessionUserFrom } from "@/lib/session/config";
import { getSession, safeNextPath } from "@/lib/session/server";

export interface LoginState {
  error?: string;
  fieldErrors?: { email?: string; password?: string };
  email: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function loginErrorMessage(error: unknown): string {
  if (!isApiError(error)) {
    return "Something went wrong while signing in. Please try again.";
  }
  switch (error.code) {
    case "INVALID_CREDENTIALS":
      return "Incorrect email or password.";
    case "ACCOUNT_INACTIVE":
      return "This account is suspended or deleted.";
    case "RATE_LIMITED":
      return "Too many sign-in attempts. Wait a minute and try again.";
    case "VALIDATION_FAILED":
      return "Check the email and password and try again.";
    case "NETWORK_ERROR":
      return error.message;
    default:
      return "Could not sign in right now. Please try again.";
  }
}

export async function loginAction(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeNextPath(formData.get("next")) ?? "/content";

  const fieldErrors: LoginState["fieldErrors"] = {};
  if (!EMAIL_PATTERN.test(email)) fieldErrors.email = "Enter your email address.";
  if (password.length === 0) fieldErrors.password = "Enter your password.";
  if (fieldErrors.email || fieldErrors.password) {
    return { email, fieldErrors };
  }

  let result: AuthResponse;
  try {
    result = await loginWithPassword({ email, password });
  } catch (error) {
    return { email, error: loginErrorMessage(error) };
  }

  if (result.user.role !== "admin") {
    // Do not leave a session behind for an account that cannot use the dashboard.
    try {
      await revokeRefreshToken(result.tokens.refreshToken);
    } catch {
      // Best effort.
    }
    return {
      email,
      error: "This account does not have admin access. Sign in with an admin account.",
    };
  }

  const session = await getSession();
  session.user = sessionUserFrom(result.user);
  applyTokens(session, result.tokens);
  session.recoveredAt = undefined;
  await session.save();

  redirect(next);
}
