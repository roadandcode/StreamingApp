import type { NextRequest } from "next/server";
import { ApiSession } from "@/lib/api/server";
import { emptyResponse, errorResponse, rejectCrossOrigin, webError } from "@/lib/http/route";
import { isUuid } from "@/lib/session/codec";

/**
 * Ends a playback session (`DELETE /v1/playback/sessions/:id`). Called with `navigator.sendBeacon`
 * when the viewer leaves the page, which can only send POST requests.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const blocked = rejectCrossOrigin(request);
  if (blocked) return blocked;

  const { id } = await context.params;
  if (!isUuid(id)) return errorResponse(webError(400, "BAD_REQUEST"));

  const api = await ApiSession.load();
  if (!api.data) return errorResponse(webError(401, "UNAUTHENTICATED"));

  try {
    await api.fetch(`/v1/playback/sessions/${id}`, { method: "DELETE" });
    return emptyResponse(204);
  } catch (error) {
    return errorResponse(error);
  }
}
