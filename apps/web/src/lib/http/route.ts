import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { ApiError, asApiError, defaultMessageForCode } from "@/lib/api/errors";
import { getConfig } from "@/lib/config";
import { isAllowedOrigin } from "@/lib/security/origin";

/** Helpers shared by the web app's own route handlers (the browser-facing BFF endpoints). */

const NO_STORE = { "cache-control": "no-store" };

export function jsonResponse(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: NO_STORE });
}

export function emptyResponse(status = 204): NextResponse {
  return new NextResponse(null, { status, headers: NO_STORE });
}

/** Every error leaves in the API's `{ statusCode, code, message }` shape. */
export function errorResponse(error: unknown): NextResponse {
  const apiError = asApiError(error);
  return NextResponse.json(apiError.toBody(), { status: apiError.status, headers: NO_STORE });
}

export function webError(status: number, code: string): ApiError {
  return new ApiError(status, code, defaultMessageForCode(code));
}

/** Rejects cross-site requests to mutating handlers; returns `null` when the request may proceed. */
export function rejectCrossOrigin(request: NextRequest): NextResponse | null {
  const allowed = [getConfig().siteUrl, request.nextUrl.origin];
  if (isAllowedOrigin(request.headers.get("origin"), request.headers.get("sec-fetch-site"), allowed)) return null;
  return errorResponse(webError(403, "INVALID_ORIGIN"));
}

/** Parses a small JSON body; `undefined` for an empty body, `null` for invalid JSON. */
export async function readJsonBody(request: NextRequest, maxBytes = 4096): Promise<unknown> {
  const text = await request.text();
  if (text.length === 0) return undefined;
  if (text.length > maxBytes) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
