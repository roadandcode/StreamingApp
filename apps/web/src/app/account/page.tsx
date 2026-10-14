import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { signOut } from "@/app/actions/auth";
import { DeleteAccountForm } from "@/components/account/DeleteAccountForm";
import { DeviceList } from "@/components/devices/DeviceList";
import { ApiError, defaultMessageForCode } from "@/lib/api/errors";
import { renderApiFetch } from "@/lib/api/server";
import type { Device, SubscriptionView, User } from "@/lib/api/types";
import { formatDate, subscriptionStatusLabel } from "@/lib/format";
import { loginPath } from "@/lib/navigation";
import { readInstallationId, readSession } from "@/lib/session/server";
import styles from "./page.module.css";

export const metadata: Metadata = { title: "Your account", robots: { index: false, follow: false } };

const NOTICES: Record<string, string> = { "device-removed": "The device was removed." };

const PROVIDER_LABELS: Record<string, string> = {
  razorpay: "Web (Razorpay)",
  google: "Google Play",
  apple: "App Store",
  fake: "Test purchase",
};

async function settle<T>(promise: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  try {
    return { ok: true, value: await promise };
  } catch (error) {
    return { ok: false, error };
  }
}

export default async function AccountPage({ searchParams }: { searchParams: Promise<Record<string, string | string[]>> }) {
  const session = await readSession();
  if (!session) redirect(loginPath("/account"));
  const params = await searchParams;
  const notice = typeof params.notice === "string" ? NOTICES[params.notice] : undefined;
  const errorCode = typeof params.error === "string" ? params.error : null;

  const [me, subscription, devices] = await Promise.all([
    settle(renderApiFetch<User>("/v1/me")),
    settle(renderApiFetch<SubscriptionView>("/v1/me/subscription")),
    settle(renderApiFetch<Device[]>("/v1/me/devices")),
  ]);
  if (!me.ok && me.error instanceof ApiError && me.error.status === 401) redirect(loginPath("/account"));
  const installationId = await readInstallationId();

  const user = me.ok ? me.value : null;
  const sub = subscription.ok ? subscription.value : null;

  return (
    <div className={`container page ${styles.page}`}>
      <h1>Your account</h1>
      {notice ? <p className="alert alert-success">{notice}</p> : null}
      {errorCode ? <p className="alert alert-error">{defaultMessageForCode(errorCode)}</p> : null}

      <section className={`panel ${styles.section}`} aria-labelledby="profile-title">
        <h2 id="profile-title">Profile</h2>
        <dl className={styles.facts}>
          <dt>Email</dt>
          <dd data-testid="account-email">{user?.email ?? session.user.email}</dd>
          <dt>Name</dt>
          <dd>{user?.displayName ?? session.user.displayName ?? "—"}</dd>
          <dt>Member since</dt>
          <dd>{formatDate(user?.createdAt) ?? "—"}</dd>
        </dl>
      </section>

      <section className={`panel ${styles.section}`} aria-labelledby="subscription-title">
        <h2 id="subscription-title">Subscription</h2>
        {sub ? (
          <>
            <p className={styles.status} data-testid="subscription-status" data-has-access={sub.hasAccess}>
              <span className={`badge ${sub.hasAccess ? "badge-free" : "badge-neutral"}`}>
                {subscriptionStatusLabel(sub.status)}
              </span>
              {sub.hasAccess ? <span>Premium is unlocked on the web and on Android.</span> : null}
            </p>
            <dl className={styles.facts}>
              {sub.planCode ? (
                <>
                  <dt>Plan</dt>
                  <dd>{sub.planCode}</dd>
                </>
              ) : null}
              {sub.provider ? (
                <>
                  <dt>Bought through</dt>
                  <dd>{PROVIDER_LABELS[sub.provider] ?? sub.provider}</dd>
                </>
              ) : null}
              {sub.accessUntil ? (
                <>
                  <dt>{sub.autoRenewEnabled ? "Renews on" : "Access until"}</dt>
                  <dd>{formatDate(sub.accessUntil)}</dd>
                </>
              ) : null}
            </dl>
            {sub.provider === "google" ? (
              <p className="subtle">Manage or cancel this subscription in the Google Play app.</p>
            ) : null}
            {!sub.hasAccess ? (
              <Link href="/subscribe" className="btn btn-primary">
                See plans
              </Link>
            ) : null}
          </>
        ) : (
          <p className="alert alert-error">Your subscription could not be loaded right now.</p>
        )}
      </section>

      <section className={`panel ${styles.section}`} id="devices" aria-labelledby="devices-title">
        <h2 id="devices-title">Devices</h2>
        <p className="muted">
          Each browser and phone you sign in on counts as a device. Removing one signs it out of playback.
        </p>
        {devices.ok ? (
          <DeviceList devices={devices.value} currentInstallationId={installationId} from="account" />
        ) : (
          <p className="alert alert-error">Your devices could not be loaded right now.</p>
        )}
      </section>

      <section className={`panel ${styles.section}`} aria-labelledby="session-title">
        <h2 id="session-title">Sign out</h2>
        <form action={signOut}>
          <button type="submit" className="btn btn-secondary" data-testid="sign-out">
            Sign out of this browser
          </button>
        </form>
      </section>

      <section className={`panel ${styles.section} ${styles.danger}`} aria-labelledby="danger-title">
        <h2 id="danger-title">Delete account</h2>
        <DeleteAccountForm />
      </section>
    </div>
  );
}
