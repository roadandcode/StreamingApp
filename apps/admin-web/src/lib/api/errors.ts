import type { ApiErrorCode, FieldError } from "./types";

/** Codes the dashboard produces itself when there is no usable API error body. */
export type ClientErrorCode = "NETWORK_ERROR" | "UNEXPECTED_RESPONSE";

export type ErrorCode = ApiErrorCode | ClientErrorCode;

/**
 * Error thrown by every API call. `code` is the stable contract code clients branch on;
 * `message` is human readable and may change.
 */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  /** Per-field problems of a 400 VALIDATION_FAILED; empty otherwise. */
  readonly fieldErrors: readonly FieldError[];

  constructor(code: ErrorCode, statusCode: number, message: string, fieldErrors: readonly FieldError[] = []) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.statusCode = statusCode;
    this.fieldErrors = fieldErrors;
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseFieldErrors(value: unknown): FieldError[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (item): item is FieldError => isRecord(item) && typeof item.field === "string" && typeof item.message === "string",
  );
}

/** Builds an `ApiError` from a non-2xx response, tolerating bodies that are not in the contract format. */
export async function errorFromResponse(response: Response): Promise<ApiError> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }

  if (isRecord(body) && typeof body.code === "string") {
    const rawMessage = body.message;
    const message = Array.isArray(rawMessage)
      ? rawMessage.map(String).join("; ")
      : typeof rawMessage === "string" && rawMessage.length > 0
        ? rawMessage
        : `Request failed with status ${response.status}.`;
    const statusCode = typeof body.statusCode === "number" ? body.statusCode : response.status;
    return new ApiError(body.code as ErrorCode, statusCode, message, parseFieldErrors(body.errors));
  }

  return new ApiError(
    "UNEXPECTED_RESPONSE",
    response.status,
    `The API returned an unexpected response (HTTP ${response.status}).`,
  );
}

export function networkError(cause: unknown): ApiError {
  const timedOut =
    cause instanceof Error && (cause.name === "TimeoutError" || cause.name === "AbortError");
  return new ApiError(
    "NETWORK_ERROR",
    0,
    timedOut
      ? "The API did not respond in time. Please try again."
      : "Could not reach the API. Check that it is running and try again.",
  );
}

/** A message suitable for showing to the signed-in admin. */
export function describeApiError(error: ApiError): string {
  switch (error.code) {
    case "FORBIDDEN":
      return "Your account does not have admin access. Sign in with an admin account.";
    case "NOT_FOUND":
      return "This item no longer exists. It may have been removed; refresh the page.";
    case "NETWORK_ERROR":
      return error.message;
    case "RATE_LIMITED":
      return "Too many requests. Wait a moment and try again.";
    case "ASSET_NOT_READY":
      return "The video is not ready yet. Upload a video and wait for processing to finish before publishing.";
    case "UNAUTHENTICATED":
      return "Your session has expired. Please sign in again.";
    case "VALIDATION_FAILED":
      return `The API rejected the request: ${error.message}`;
    default:
      return error.message || "Something went wrong. Please try again.";
  }
}
