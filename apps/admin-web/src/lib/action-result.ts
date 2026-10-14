import "server-only";

import { redirect } from "next/navigation";
import { describeApiError, isApiError } from "./api/errors";
import { loginPath } from "./session/server";

export type ActionResult<T = undefined> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string; code?: string };

/**
 * Converts an error thrown inside a server action into a result the form can show. An expired
 * session redirects to the login page; anything that is not an API error is rethrown so Next's
 * own control flow (redirects) and the error boundary still work.
 */
export function actionFailure(error: unknown): { ok: false; error: string; code?: string } {
  if (!isApiError(error)) {
    throw error;
  }
  if (error.code === "UNAUTHENTICATED") {
    redirect(loginPath("expired"));
  }
  return { ok: false, error: describeApiError(error), code: error.code };
}
