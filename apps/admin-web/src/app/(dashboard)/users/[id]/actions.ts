"use server";

import { revalidatePath } from "next/cache";
import type { SimpleActionState } from "@/lib/action-state";
import { actionFailure } from "@/lib/action-result";
import { revokeDevice, revokePlaybackSession, revokeUserSessions } from "@/lib/api/admin";
import { isUuid } from "@/lib/page-data";
import { requireAdminSession } from "@/lib/session/server";

async function run(userId: string, targetId: string, call: () => Promise<void>, message: string): Promise<SimpleActionState> {
  await requireAdminSession();
  if (!isUuid(userId) || !isUuid(targetId)) {
    return { status: "error", message: "Unknown user, device or session." };
  }
  try {
    await call();
  } catch (error) {
    return { status: "error", message: actionFailure(error).error };
  }
  revalidatePath(`/users/${userId}`);
  return { status: "done", message };
}

export async function revokeDeviceAction(
  userId: string,
  deviceId: string,
  _previous: SimpleActionState,
  _formData: FormData,
): Promise<SimpleActionState> {
  return run(userId, deviceId, () => revokeDevice(deviceId), "Device revoked.");
}

export async function revokePlaybackSessionAction(
  userId: string,
  playbackSessionId: string,
  _previous: SimpleActionState,
  _formData: FormData,
): Promise<SimpleActionState> {
  return run(userId, playbackSessionId, () => revokePlaybackSession(playbackSessionId), "Playback session revoked.");
}

export async function revokeAllSessionsAction(
  userId: string,
  _previous: SimpleActionState,
  _formData: FormData,
): Promise<SimpleActionState> {
  return run(
    userId,
    userId,
    () => revokeUserSessions(userId),
    "Signed out everywhere. The user must sign in again on every device.",
  );
}
