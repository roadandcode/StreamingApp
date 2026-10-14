import type { ApiErrorBody, ApiErrorCode, FieldError } from "./types";

/**
 * Codes produced by the web app itself (never by the API). They use the same
 * `{ statusCode, code, message }` shape so the browser handles every error the same way.
 */
export type WebErrorCode =
  | "NETWORK_ERROR"
  | "UNKNOWN_ERROR"
  | "DRM_REQUIRED"
  | "INVALID_ORIGIN"
  | "BAD_REQUEST";

export type ErrorCode = ApiErrorCode | WebErrorCode;

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode | (string & {});
  /** Field-level details of a `400 VALIDATION_FAILED`; empty otherwise. */
  readonly fieldErrors: FieldError[];

  constructor(status: number, code: string, message: string, fieldErrors: FieldError[] = []) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors;
  }

  toBody(): ApiErrorBody {
    const body: ApiErrorBody = { statusCode: this.status, code: this.code, message: this.message };
    if (this.fieldErrors.length > 0) body.errors = this.fieldErrors;
    return body;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseFieldErrors(value: unknown): FieldError[] {
  if (!Array.isArray(value)) return [];
  const result: FieldError[] = [];
  for (const entry of value) {
    if (isRecord(entry) && typeof entry.field === "string" && typeof entry.message === "string") {
      result.push({ field: entry.field, message: entry.message });
    }
  }
  return result;
}

/**
 * Maps a non-2xx API response to a typed error. `body` is the parsed JSON body, or `undefined` when
 * the body was empty or not JSON (for example an HTML error page from a proxy).
 */
export function toApiError(status: number, body: unknown): ApiError {
  if (isRecord(body) && typeof body.code === "string" && body.code.length > 0) {
    const message =
      typeof body.message === "string" && body.message.length > 0
        ? body.message
        : defaultMessageForCode(body.code);
    const statusCode = typeof body.statusCode === "number" ? body.statusCode : status;
    return new ApiError(statusCode, body.code, message, parseFieldErrors(body.errors));
  }
  if (status === 401) return new ApiError(401, "UNAUTHENTICATED", defaultMessageForCode("UNAUTHENTICATED"));
  if (status === 404) return new ApiError(404, "NOT_FOUND", defaultMessageForCode("NOT_FOUND"));
  if (status === 429) return new ApiError(429, "RATE_LIMITED", defaultMessageForCode("RATE_LIMITED"));
  return new ApiError(status, "UNKNOWN_ERROR", defaultMessageForCode("UNKNOWN_ERROR"));
}

/** Any thrown value → ApiError. Network failures become `NETWORK_ERROR` (HTTP 503 towards the browser). */
export function asApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  return new ApiError(503, "NETWORK_ERROR", defaultMessageForCode("NETWORK_ERROR"));
}

/** Parses an error response from the web app's own route handlers (same shape as the API's). */
export function parseErrorBody(status: number, body: unknown): ApiErrorBody {
  return toApiError(status, body).toBody();
}

/**
 * Field errors keyed by the top-level request field (`"regions.0"` → `"regions"`), first message
 * wins. Used to show validation messages next to the matching form input.
 */
export function fieldErrorMap(errors: readonly FieldError[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const { field, message } of errors) {
    const key = field.split(".")[0] ?? field;
    if (key && !(key in map)) map[key] = message;
  }
  return map;
}

const MESSAGES: Record<string, string> = {
  VALIDATION_FAILED: "Some of the details you entered are not valid.",
  INVALID_PURCHASE: "The payment could not be verified. You have not been given access.",
  UNAUTHENTICATED: "Your session has expired. Please sign in again.",
  INVALID_CREDENTIALS: "That email and password do not match an account.",
  INVALID_REFRESH_TOKEN: "Your session has expired. Please sign in again.",
  FORBIDDEN: "You do not have permission to do that.",
  ACCOUNT_INACTIVE: "This account is not active. Contact support for help.",
  ENTITLEMENT_REQUIRED: "A subscription is required to watch this.",
  REGION_NOT_ALLOWED: "This title is not available in your country.",
  CONTENT_NOT_PLAYABLE: "This title cannot be played right now.",
  DEVICE_NOT_REGISTERED: "This browser is not registered as one of your devices.",
  DEVICE_REVOKED: "This browser has been blocked from your account. Contact support for help.",
  CONCURRENT_STREAM_LIMIT:
    "You are already watching on too many screens. Stop playback on another device and try again.",
  PLAYBACK_SESSION_ENDED: "This playback session has ended.",
  NOT_FOUND: "We could not find what you were looking for.",
  EMAIL_TAKEN: "An account with this email already exists. Try signing in instead.",
  DEVICE_LIMIT_REACHED: "You have reached the maximum number of devices. Remove one to add this browser.",
  PURCHASE_BELONGS_TO_OTHER_ACCOUNT: "This subscription is already linked to a different account.",
  RATE_LIMITED: "Too many attempts. Please wait a moment and try again.",
  PROVIDER_NOT_CONFIGURED: "Payments are not configured yet. Please try again later.",
  NETWORK_ERROR: "We could not reach the service. Check your connection and try again.",
  DRM_REQUIRED: "Protected playback is required, but it is not available for this title in this browser.",
  INVALID_ORIGIN: "This request was blocked for your security. Reload the page and try again.",
  BAD_REQUEST: "The request was not valid.",
  UNKNOWN_ERROR: "Something went wrong. Please try again.",
};

/** A human-friendly message for an error code; used when the API message is missing. */
export function defaultMessageForCode(code: string): string {
  return MESSAGES[code] ?? MESSAGES.UNKNOWN_ERROR!;
}

/** Message shown to viewers. We prefer our own wording for known codes; the API's text is a fallback. */
export function userMessage(error: Pick<ApiErrorBody, "code" | "message">): string {
  return MESSAGES[error.code] ?? (error.message || MESSAGES.UNKNOWN_ERROR!);
}
