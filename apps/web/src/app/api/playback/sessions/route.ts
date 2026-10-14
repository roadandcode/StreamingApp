import type { NextRequest } from "next/server";
import { asApiError } from "@/lib/api/errors";
import { ApiSession } from "@/lib/api/server";
import type { PlaybackAuthorization } from "@/lib/api/types";
import { getConfig } from "@/lib/config";
import { errorResponse, jsonResponse, readJsonBody, rejectCrossOrigin, webError } from "@/lib/http/route";
import { parseStartPlaybackBody } from "@/lib/player/validation";

/**
 * Starts a playback session for this browser: `POST /v1/playback/sessions` with the device id from
 * the encrypted session (never from the browser) and the DRM systems the browser reported.
 */
export async function POST(request: NextRequest) {
  const blocked = rejectCrossOrigin(request);
  if (blocked) return blocked;

  const body = parseStartPlaybackBody(await readJsonBody(request));
  if (!body) return errorResponse(webError(400, "BAD_REQUEST"));

  const api = await ApiSession.load();
  const session = api.data;
  if (!session) return errorResponse(webError(401, "UNAUTHENTICATED"));
  if (!session.deviceId) return errorResponse(webError(403, "DEVICE_NOT_REGISTERED"));

  try {
    const authorization = await api.fetch<PlaybackAuthorization>("/v1/playback/sessions", {
      method: "POST",
      body: { contentId: body.contentId, deviceId: session.deviceId, supportedDrm: body.supportedDrm },
    });

    if (getConfig().requireDrm && authorization.drm === null) {
      // Policy: no unprotected playback. End the session we just opened and never hand out the URL.
      await api
        .fetch(`/v1/playback/sessions/${encodeURIComponent(authorization.playbackSessionId)}`, { method: "DELETE" })
        .catch(() => undefined);
      return errorResponse(webError(403, "DRM_REQUIRED"));
    }

    return jsonResponse(authorization, 201);
  } catch (error) {
    const apiError = asApiError(error);
    if (apiError.code === "DEVICE_NOT_REGISTERED" || apiError.code === "DEVICE_REVOKED") {
      // The stored device id is no longer valid; the /device page registers this browser again.
      await api.update({ deviceId: null });
    }
    return errorResponse(apiError);
  }
}
