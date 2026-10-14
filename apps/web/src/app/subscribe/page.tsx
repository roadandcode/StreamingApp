import type { Metadata } from "next";
import Link from "next/link";
import { PlanActions } from "@/components/subscribe/PlanActions";
import { PLAN_PRICE_LABELS_INR } from "@/config/plan-prices";
import type { Plan } from "@/lib/api/types";
import { getConfig } from "@/lib/config";
import { billingPeriodLabel, formatDate, subscriptionStatusLabel } from "@/lib/format";
import { getPlans, getViewerAccess } from "@/lib/viewer";
import styles from "./page.module.css";

export const metadata: Metadata = { title: "Plans", robots: { index: false, follow: true } };

const FEATURES = [
  "Every premium course and video",
  "Watch on the web and in the Android app",
  "New originals every month",
  "Cancel any time; access lasts until the end of the paid period",
];

function fakeProduct(plan: Plan): string | null {
  return plan.storeProducts.find((product) => product.provider === "fake")?.productId ?? null;
}

export default async function SubscribePage() {
  const { fakeBilling } = getConfig();
  const [plansResult, access] = await Promise.all([
    getPlans().then(
      (plans) => ({ ok: true as const, plans }),
      () => ({ ok: false as const, plans: [] as Plan[] }),
    ),
    getViewerAccess(),
  ]);
  const plans = plansResult.plans;
  const subscription = access.subscription;

  return (
    <div className={`container page ${styles.page}`}>
      <header className={styles.header}>
        <h1>Choose your plan</h1>
        <p className="muted">
          One subscription unlocks every premium lesson on this website and in the Android app. Pay securely with UPI,
          cards or netbanking through Razorpay.
        </p>
      </header>

      {access.hasAccess && subscription ? (
        <div className="alert alert-success" data-testid="already-subscribed">
          <strong>You&apos;re subscribed</strong> ({subscriptionStatusLabel(subscription.status)}
          {subscription.accessUntil ? `, access until ${formatDate(subscription.accessUntil)}` : ""}).{" "}
          <Link href="/">Start watching →</Link>
        </div>
      ) : subscription && subscription.status === "pending" ? (
        <div className="alert alert-info">Your last payment is still being confirmed. This page updates once it completes.</div>
      ) : null}

      {!plansResult.ok ? (
        <p className="alert alert-error">Plans could not be loaded right now. Please try again in a moment.</p>
      ) : plans.length === 0 ? (
        <p className="muted">No plans are available yet.</p>
      ) : (
        <div className={styles.grid}>
          {plans.map((plan) => {
            const price = PLAN_PRICE_LABELS_INR[plan.code];
            return (
              <section key={plan.code} className={styles.plan} data-testid="plan" data-plan-code={plan.code}>
                <div className={styles.planHead}>
                  <h2 className={styles.planName}>{plan.name}</h2>
                  {plan.billingPeriod === "P1Y" ? <span className="badge badge-premium">Best value</span> : null}
                </div>
                {/* Prices come from configuration (src/config/plan-prices.ts), never from the API. */}
                <p className={styles.price} data-testid="plan-price">
                  {price ?? "Price shown at checkout"}
                </p>
                <p className="subtle">{billingPeriodLabel(plan.billingPeriod)} · Auto-renews until cancelled</p>
                <ul className={styles.features}>
                  {FEATURES.map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
                {access.hasAccess ? (
                  <p className="subtle">You already have access.</p>
                ) : (
                  <PlanActions
                    planCode={plan.code}
                    planName={plan.name}
                    signedIn={access.signedIn}
                    fakeProductId={fakeBilling ? fakeProduct(plan) : null}
                  />
                )}
              </section>
            );
          })}
        </div>
      )}

      <p className={`subtle ${styles.note}`}>
        Subscribed through Google Play on Android? You are already covered here: sign in with the same account.
      </p>
    </div>
  );
}
