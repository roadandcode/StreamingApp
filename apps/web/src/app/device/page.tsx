import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { registerDevice } from "@/app/actions/devices";
import { DeviceList } from "@/components/devices/DeviceList";
import { defaultMessageForCode } from "@/lib/api/errors";
import { renderApiFetch } from "@/lib/api/server";
import type { Device } from "@/lib/api/types";
import { loginPath, safeNextPath } from "@/lib/navigation";
import { readInstallationId, readSession } from "@/lib/session/server";

export const metadata: Metadata = { title: "Your devices", robots: { index: false, follow: false } };

type SearchParams = Promise<Record<string, string | string[]>>;

/**
 * Device setup for this browser: register it, or free a slot when the account has reached the
 * device limit (`409 DEVICE_LIMIT_REACHED`), or explain an admin block (`403 DEVICE_REVOKED`).
 */
export default async function DevicePage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const next = safeNextPath(typeof params.next === "string" ? params.next : undefined);
  const reason = typeof params.reason === "string" ? params.reason : null;
  const errorCode = typeof params.error === "string" ? params.error : null;

  const session = await readSession();
  if (!session) redirect(loginPath(`/device?next=${encodeURIComponent(next)}`));

  let devices: Device[] = [];
  let loadError = false;
  try {
    devices = await renderApiFetch<Device[]>("/v1/me/devices");
  } catch {
    loadError = true;
  }
  const installationId = await readInstallationId();
  const thisDevice = devices.find((device) => device.installationId === installationId);
  const registered = Boolean(session.deviceId && thisDevice && thisDevice.id === session.deviceId);

  return (
    <div className="container page narrow">
      <h1>This browser</h1>

      {errorCode ? <p className="alert alert-error">{defaultMessageForCode(errorCode)}</p> : null}

      {reason === "blocked" ? (
        <div className="alert alert-error" data-testid="device-blocked">
          <strong>This browser has been blocked from your account.</strong>
          <p className="muted" style={{ margin: 0 }}>
            Our support team blocked it, so it cannot play videos. You can still browse and manage your account. Contact
            support if you think this is a mistake.
          </p>
        </div>
      ) : registered ? (
        <div className="alert alert-success">
          This browser is registered to your account.{" "}
          <Link href={next} className="btn btn-primary btn-small">
            Continue
          </Link>
        </div>
      ) : reason === "limit" ? (
        <div className="alert alert-info" data-testid="device-limit">
          <strong>You have reached your device limit.</strong> Remove a device below to add this browser. Removed devices
          can be added again later by signing in on them.
        </div>
      ) : (
        <div className="panel" style={{ marginBottom: 24 }}>
          <p>Register this browser as one of your devices to start watching.</p>
          <form action={registerDevice}>
            <input type="hidden" name="next" value={next} />
            <button type="submit" className="btn btn-primary">
              Register this browser
            </button>
          </form>
        </div>
      )}

      <h2 style={{ marginTop: 32 }}>Your devices</h2>
      {loadError ? (
        <p className="alert alert-error">Your devices could not be loaded. Please try again.</p>
      ) : (
        <DeviceList
          devices={devices}
          currentInstallationId={installationId}
          from="device"
          next={next}
          removeLabel={reason === "limit" ? "Remove and use this browser" : "Remove"}
        />
      )}
    </div>
  );
}
