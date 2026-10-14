import { DRM_SYSTEMS, type DrmSystem } from "@/lib/api/types";
import { isUuid } from "@/lib/session/codec";

/** Validation of the browser → web server playback requests (the API validates again). */

export interface StartPlaybackBody {
  contentId: string;
  supportedDrm: DrmSystem[];
}

export function parseStartPlaybackBody(body: unknown): StartPlaybackBody | null {
  if (typeof body !== "object" || body === null) return null;
  const { contentId, supportedDrm } = body as Record<string, unknown>;
  if (!isUuid(typeof contentId === "string" ? contentId : null)) return null;
  if (supportedDrm !== undefined && !Array.isArray(supportedDrm)) return null;
  const systems = new Set<DrmSystem>();
  for (const value of (supportedDrm as unknown[] | undefined) ?? []) {
    if (typeof value === "string" && (DRM_SYSTEMS as readonly string[]).includes(value)) {
      systems.add(value as DrmSystem);
    }
  }
  return { contentId: contentId as string, supportedDrm: [...systems] };
}

/** `positionSeconds` is optional; when present it must be a sane, non-negative number of seconds. */
export function parseHeartbeatBody(body: unknown): { positionSeconds?: number } | null {
  if (body === undefined) return {};
  if (typeof body !== "object" || body === null) return null;
  const { positionSeconds } = body as Record<string, unknown>;
  if (positionSeconds === undefined) return {};
  if (typeof positionSeconds !== "number" || !Number.isFinite(positionSeconds)) return null;
  if (positionSeconds < 0 || positionSeconds > 7 * 24 * 3600) return null;
  return { positionSeconds: Math.floor(positionSeconds) };
}
