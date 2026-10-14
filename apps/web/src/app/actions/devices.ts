"use server";

import { redirect } from "next/navigation";
import { asApiError } from "@/lib/api/errors";
import { ApiSession } from "@/lib/api/server";
import { registerThisBrowser } from "@/lib/device/register";
import { loginPath, safeNextPath } from "@/lib/navigation";
import { isUuid } from "@/lib/session/codec";

function devicePage(params: Record<string, string>): string {
  return `/device?${new URLSearchParams(params).toString()}`;
}

async function registrationDestination(api: ApiSession, next: string): Promise<string> {
  try {
    const result = await registerThisBrowser(api);
    if (result.status === "registered") return next;
    return devicePage({ reason: result.status, next });
  } catch (error) {
    return devicePage({ error: asApiError(error).code, next });
  }
}

/** "Register this browser" on the device page. */
export async function registerDevice(formData: FormData): Promise<void> {
  const next = safeNextPath(formData.get("next"));
  const api = await ApiSession.load();
  if (!api.data) redirect(loginPath(next));
  redirect(await registrationDestination(api, next));
}

/**
 * Removes one of the viewer's devices (`DELETE /v1/me/devices/:id`). From the device-limit page it
 * then retries registering this browser; from the account page it returns there.
 */
export async function removeDevice(formData: FormData): Promise<void> {
  const deviceId = String(formData.get("deviceId") ?? "");
  const from = formData.get("from") === "device" ? "device" : "account";
  const next = safeNextPath(formData.get("next"));

  const api = await ApiSession.load();
  if (!api.data) redirect(loginPath(from === "device" ? next : "/account"));
  if (!isUuid(deviceId)) redirect(from === "device" ? devicePage({ next }) : "/account");

  let destination: string;
  try {
    await api.fetch(`/v1/me/devices/${deviceId}`, { method: "DELETE" });
    if (api.data?.deviceId === deviceId) await api.update({ deviceId: null });
    destination =
      from === "device" ? await registrationDestination(api, next) : "/account?notice=device-removed#devices";
  } catch (error) {
    const code = asApiError(error).code;
    destination = from === "device" ? devicePage({ error: code, next }) : `/account?error=${code}#devices`;
  }
  redirect(destination);
}
