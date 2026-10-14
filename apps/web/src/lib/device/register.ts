import "server-only";
import { headers } from "next/headers";
import { ApiError } from "@/lib/api/errors";
import type { ApiSession } from "@/lib/api/server";
import type { Device } from "@/lib/api/types";
import { ensureInstallationId } from "@/lib/session/server";
import { deviceNameFromUserAgent } from "./device-name";

export type DeviceRegistration =
  | { status: "registered"; device: Device }
  | { status: "limit" }
  | { status: "blocked" };

/**
 * Registers this browser as one of the viewer's devices (`POST /v1/me/devices`, `platform: "web"`).
 *
 * Safe to repeat: the API answers `200` for an installation this user already registered, and
 * re-activates it if the user had removed it. `403 DEVICE_REVOKED` means an admin blocked this
 * browser; we never work around that by minting a new installation id.
 */
export async function registerThisBrowser(api: ApiSession): Promise<DeviceRegistration> {
  const installationId = await ensureInstallationId();
  const name = deviceNameFromUserAgent((await headers()).get("user-agent"));
  try {
    const device = await api.fetch<Device>("/v1/me/devices", {
      method: "POST",
      body: { installationId, platform: "web", name },
    });
    await api.update({ deviceId: device.id });
    return { status: "registered", device };
  } catch (error) {
    if (error instanceof ApiError && error.code === "DEVICE_LIMIT_REACHED") {
      await api.update({ deviceId: null });
      return { status: "limit" };
    }
    if (error instanceof ApiError && error.code === "DEVICE_REVOKED") {
      await api.update({ deviceId: null });
      return { status: "blocked" };
    }
    throw error;
  }
}
