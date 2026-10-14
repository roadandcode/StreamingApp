import { removeDevice } from "@/app/actions/devices";
import type { Device } from "@/lib/api/types";
import { formatDate } from "@/lib/format";
import styles from "./DeviceList.module.css";

const PLATFORM_LABELS: Record<Device["platform"], string> = { android: "Android app", ios: "iOS app", web: "Web browser" };

export function DeviceList({
  devices,
  currentInstallationId,
  from,
  next = "/",
  removeLabel = "Remove",
}: {
  devices: Device[];
  currentInstallationId: string | null;
  from: "account" | "device";
  next?: string;
  removeLabel?: string;
}) {
  if (devices.length === 0) return <p className="muted">No devices are registered yet.</p>;
  return (
    <ul className={styles.list} data-testid="device-list">
      {devices.map((device) => {
        const isThis = currentInstallationId !== null && device.installationId === currentInstallationId;
        return (
          <li key={device.id} className={styles.item} data-testid="device" data-this-browser={isThis}>
            <span className={styles.icon} aria-hidden="true">
              {device.platform === "web" ? "🖥" : "📱"}
            </span>
            <div className={styles.body}>
              <span className={styles.name}>
                {device.name}
                {isThis ? <span className="badge badge-free">This browser</span> : null}
              </span>
              <span className="subtle">
                {PLATFORM_LABELS[device.platform]} · Last active {formatDate(device.lastSeenAt) ?? "—"}
              </span>
            </div>
            <form action={removeDevice}>
              <input type="hidden" name="deviceId" value={device.id} />
              <input type="hidden" name="from" value={from} />
              <input type="hidden" name="next" value={next} />
              <button type="submit" className="btn btn-danger btn-small" aria-label={`${removeLabel}: ${device.name}`}>
                {removeLabel}
              </button>
            </form>
          </li>
        );
      })}
    </ul>
  );
}
