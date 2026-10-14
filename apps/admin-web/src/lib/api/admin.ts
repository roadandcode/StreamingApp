import "server-only";

import { apiFetch, type ApiCallContext } from "./client";
import type {
  AdminContent,
  AdminContentListQuery,
  AdminContentWithChildren,
  AdminUserDetail,
  AdminUserListItem,
  AdminUserListQuery,
  CreateContentRequest,
  Paginated,
  UpdateContentRequest,
  UploadSession,
} from "./types";

const segment = encodeURIComponent;

// Content -------------------------------------------------------------------------------------

export function listContent(query: AdminContentListQuery): Promise<Paginated<AdminContent>> {
  return apiFetch("/v1/admin/content", { query: { ...query } });
}

export function getContent(id: string, context: ApiCallContext = "render"): Promise<AdminContentWithChildren> {
  return apiFetch(`/v1/admin/content/${segment(id)}`, { context });
}

export function createContent(body: CreateContentRequest): Promise<AdminContent> {
  return apiFetch("/v1/admin/content", { method: "POST", body, context: "action" });
}

export function updateContent(id: string, body: UpdateContentRequest): Promise<AdminContent> {
  return apiFetch(`/v1/admin/content/${segment(id)}`, { method: "PATCH", body, context: "action" });
}

export function createUploadSession(id: string): Promise<UploadSession> {
  return apiFetch(`/v1/admin/content/${segment(id)}/upload-session`, { method: "POST", context: "action" });
}

export function publishContent(id: string): Promise<AdminContent> {
  return apiFetch(`/v1/admin/content/${segment(id)}/publish`, { method: "POST", context: "action" });
}

export function unpublishContent(id: string): Promise<AdminContent> {
  return apiFetch(`/v1/admin/content/${segment(id)}/unpublish`, { method: "POST", context: "action" });
}

// Users ---------------------------------------------------------------------------------------

export function searchUsers(query: AdminUserListQuery): Promise<Paginated<AdminUserListItem>> {
  return apiFetch("/v1/admin/users", { query: { ...query } });
}

export function getUserDetail(id: string): Promise<AdminUserDetail> {
  return apiFetch(`/v1/admin/users/${segment(id)}`);
}

export function revokeUserSessions(userId: string): Promise<void> {
  return apiFetch(`/v1/admin/users/${segment(userId)}/sessions/revoke`, { method: "POST", context: "action" });
}

export function revokeDevice(deviceId: string): Promise<void> {
  return apiFetch(`/v1/admin/devices/${segment(deviceId)}/revoke`, { method: "POST", context: "action" });
}

export function revokePlaybackSession(playbackSessionId: string): Promise<void> {
  return apiFetch(`/v1/admin/playback-sessions/${segment(playbackSessionId)}/revoke`, {
    method: "POST",
    context: "action",
  });
}
