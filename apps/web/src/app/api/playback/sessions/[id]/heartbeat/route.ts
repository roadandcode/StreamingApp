import type { NextRequest } from "next/server";
import { ApiSession } from "@/lib/api/server";
import type { HeartbeatResponse } from "@/lib/api/types";
import { errorResponse, jsonResponse, readJsonBody, rejectCrossOrigin, webError } from "@/lib/http/route";
import { parseHeartbeatBody } from "@/lib/player/validation";
import { isUuid } from "@/lib/session/codec";

/** `POST /v1/playback/sessions/:id/heartbeat`. Any 403 from the API is passed through: the player stops. */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const blocked = rejectCrossOrigin(request);
  if (blocked) return blocked;

  const { id } = await context.params;
  if (!isUuid(id)) return errorResponse(webError(400, "BAD_REQUEST"));
  const body = parseHeartbeatBody(await readJsonBody(request));
  if (!body) return errorResponse(webError(400, "BAD_REQUEST"));

  const api = await ApiSession.load();
  if (!api.data) return errorResponse(webError(401, "UNAUTHENTICATED"));

  try {
    const result = await api.fetch<HeartbeatResponse>(`/v1/playback/sessions/${id}/heartbeat`, {
      method: "POST",
      body,
    });
    return jsonResponse({ expiresAt: result.expiresAt });
  } catch (error) {
    return errorResponse(error);
  }
}
