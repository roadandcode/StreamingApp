import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ConfirmActionButton } from "@/components/ConfirmActionButton";
import { ErrorPanel } from "@/components/ErrorPanel";
import { AccountBadge, Badge, SubscriptionBadge } from "@/components/StatusBadge";
import { getUserDetail } from "@/lib/api/admin";
import type { Device } from "@/lib/api/types";
import { formatDateTime, humanize, platformLabel, providerLabel } from "@/lib/format";
import { isUuid, loadPageData } from "@/lib/page-data";
import { revokeAllSessionsAction, revokeDeviceAction, revokePlaybackSessionAction } from "./actions";

export const metadata: Metadata = { title: "User" };

function sortDevices(devices: Device[]): Device[] {
  // Active devices first, then most recently seen.
  return [...devices].sort((a, b) => {
    if ((a.revokedAt === null) !== (b.revokedAt === null)) return a.revokedAt === null ? -1 : 1;
    return b.lastSeenAt.localeCompare(a.lastSeenAt);
  });
}

export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) {
    notFound();
  }

  const result = await loadPageData(() => getUserDetail(id));
  if (!result.ok) {
    return <ErrorPanel error={result.error} />;
  }
  const { user, subscription, devices, activePlaybackSessions } = result.data;
  const deviceNames = new Map(devices.map((device) => [device.id, device.name]));

  return (
    <>
      <div className="breadcrumbs">
        <Link href="/users">Users</Link> › {user.email}
      </div>

      <div className="page-header">
        <div>
          <h1>{user.email}</h1>
          <p className="actions" style={{ marginTop: "0.5rem" }}>
            {user.displayName ? <span>{user.displayName}</span> : null}
            <Badge tone={user.role === "admin" ? "info" : "neutral"}>{humanize(user.role)}</Badge>
            <AccountBadge status={user.accountStatus} />
          </p>
        </div>
        <ConfirmActionButton
          key={user.id}
          action={revokeAllSessionsAction.bind(null, user.id)}
          label="Sign out everywhere"
          pendingLabel="Signing out…"
          confirmMessage={`Sign ${user.email} out of every device? They will have to sign in again.`}
        />
      </div>

      <section className="card" aria-labelledby="subscription-heading">
        <div className="card-header">
          <h2 id="subscription-heading">Subscription</h2>
          <span className="actions">
            <SubscriptionBadge status={subscription.status} />
            <Badge tone={subscription.hasAccess ? "success" : "neutral"}>
              {subscription.hasAccess ? "Has premium access" : "No premium access"}
            </Badge>
          </span>
        </div>
        <dl className="details">
          <dt>Status</dt>
          <dd>{humanize(subscription.status)}</dd>
          <dt>Access tier</dt>
          <dd>{subscription.accessTier ? humanize(subscription.accessTier) : "—"}</dd>
          <dt>Plan</dt>
          <dd>{subscription.planCode ?? "—"}</dd>
          <dt>Billed through</dt>
          <dd>{subscription.provider ? providerLabel(subscription.provider) : "—"}</dd>
          <dt>Access until</dt>
          <dd>{formatDateTime(subscription.accessUntil)}</dd>
          <dt>Auto-renew</dt>
          <dd>{subscription.autoRenewEnabled ? "On" : "Off"}</dd>
        </dl>
      </section>

      <section className="card" aria-labelledby="devices-heading">
        <h2 id="devices-heading">Devices</h2>
        {devices.length === 0 ? (
          <p className="empty">No devices registered.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Platform</th>
                  <th scope="col">Installation</th>
                  <th scope="col">Last seen</th>
                  <th scope="col">Registered</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="muted">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortDevices(devices).map((device) => (
                  <tr key={device.id} data-testid="device-row">
                    <td>{device.name}</td>
                    <td>{platformLabel(device.platform)}</td>
                    <td className="mono" title={device.installationId}>
                      {device.installationId.slice(0, 8)}…
                    </td>
                    <td>{formatDateTime(device.lastSeenAt)}</td>
                    <td>{formatDateTime(device.createdAt)}</td>
                    <td>
                      {device.revokedAt ? (
                        <span title={formatDateTime(device.revokedAt)}>
                          <Badge tone="danger">Revoked</Badge>
                        </span>
                      ) : (
                        <Badge tone="success">Active</Badge>
                      )}
                    </td>
                    <td>
                      {device.revokedAt ? (
                        <span className="hint">{formatDateTime(device.revokedAt)}</span>
                      ) : (
                        <ConfirmActionButton
                          action={revokeDeviceAction.bind(null, user.id, device.id)}
                          label="Revoke device"
                          pendingLabel="Revoking…"
                          size="small"
                          confirmMessage={`Revoke “${device.name}”? It is signed out of playback and cannot be used again.`}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card" aria-labelledby="playback-heading">
        <h2 id="playback-heading">Active playback sessions</h2>
        {activePlaybackSessions.length === 0 ? (
          <p className="empty">Nothing is playing right now.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Content</th>
                  <th scope="col">Device</th>
                  <th scope="col">Started</th>
                  <th scope="col">Last heartbeat</th>
                  <th scope="col">
                    <span className="muted">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {activePlaybackSessions.map((session) => (
                  <tr key={session.id} data-testid="playback-row">
                    <td>
                      <Link href={`/content/${session.contentId}`}>{session.contentTitle}</Link>
                    </td>
                    <td>{deviceNames.get(session.deviceId) ?? <span className="mono">{session.deviceId}</span>}</td>
                    <td>{formatDateTime(session.startedAt)}</td>
                    <td>{formatDateTime(session.lastHeartbeatAt)}</td>
                    <td>
                      <ConfirmActionButton
                        action={revokePlaybackSessionAction.bind(null, user.id, session.id)}
                        label="Revoke"
                        pendingLabel="Revoking…"
                        size="small"
                        confirmMessage={`Stop “${session.contentTitle}” playing on this device now?`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card" aria-labelledby="account-heading">
        <h2 id="account-heading">Account</h2>
        <dl className="details">
          <dt>User ID</dt>
          <dd className="mono">{user.id}</dd>
          <dt>Display name</dt>
          <dd>{user.displayName ?? "—"}</dd>
          <dt>Joined</dt>
          <dd>{formatDateTime(user.createdAt)}</dd>
        </dl>
      </section>
    </>
  );
}
