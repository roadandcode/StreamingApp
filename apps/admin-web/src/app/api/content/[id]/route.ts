import { getContent } from "@/lib/api/admin";
import { isApiError } from "@/lib/api/errors";
import type { ContentStatusResponse } from "@/lib/content-status";
import { isUuid } from "@/lib/page-data";

/**
 * GET /api/content/:id — read-only status endpoint for the browser's upload panel. Runs with
 * the session cookie on the server; the browser never sees the admin's tokens.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) {
    return Response.json({ statusCode: 404, code: "NOT_FOUND", message: "Content not found." }, { status: 404 });
  }

  try {
    const content = await getContent(id, "action");
    const body: ContentStatusResponse = {
      id: content.id,
      publicationStatus: content.publicationStatus,
      asset: content.asset,
    };
    return Response.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (isApiError(error)) {
      const status = error.statusCode >= 400 ? error.statusCode : 502;
      return Response.json({ statusCode: status, code: error.code, message: error.message }, { status });
    }
    throw error;
  }
}
