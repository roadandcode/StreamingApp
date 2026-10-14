"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { simulatePurchase, startRazorpayCheckout } from "@/app/actions/checkout";
import { parseErrorBody, userMessage } from "@/lib/api/errors";
import type { SubscriptionView } from "@/lib/api/types";
import { loadRazorpayCheckout, mapRazorpaySuccess } from "@/lib/checkout/razorpay";
import { SITE_NAME } from "@/lib/format";
import styles from "./PlanActions.module.css";

type State =
  | { kind: "idle" }
  | { kind: "busy"; label: string }
  | { kind: "checkout" }
  | { kind: "dismissed" }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string; code?: string };

export function PlanActions({
  planCode,
  planName,
  signedIn,
  fakeProductId,
}: {
  planCode: string;
  planName: string;
  signedIn: boolean;
  /** Set only when NEXT_PUBLIC_FAKE_BILLING is on and the plan has a fake store product. */
  fakeProductId: string | null;
}) {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "idle" });
  const busy = state.kind === "busy" || state.kind === "checkout";

  function onVerified(subscription: SubscriptionView) {
    setState(
      subscription.hasAccess
        ? { kind: "success", message: "You're subscribed. Premium is unlocked on the web and on Android." }
        : {
            kind: "success",
            message: "Payment received. Your subscription will be active in a moment; refresh this page shortly.",
          },
    );
    router.refresh();
  }

  async function subscribe() {
    setState({ kind: "busy", label: "Preparing checkout…" });
    const start = await startRazorpayCheckout(planCode);
    if (!start.ok) {
      if (start.code === "UNAUTHENTICATED") {
        router.push(`/login?next=${encodeURIComponent("/subscribe")}`);
        return;
      }
      setState({ kind: "error", message: start.message, code: start.code });
      return;
    }

    let Razorpay;
    try {
      Razorpay = await loadRazorpayCheckout();
    } catch {
      setState({ kind: "error", message: "The payment window could not be loaded. Check your connection and try again." });
      return;
    }

    let finished = false;
    const checkout = new Razorpay({
      key: start.keyId,
      subscription_id: start.razorpaySubscriptionId,
      name: SITE_NAME,
      description: planName,
      prefill: start.email ? { email: start.email } : undefined,
      theme: { color: "#ff7a1a" },
      modal: {
        ondismiss: () => {
          if (!finished) setState({ kind: "dismissed" });
        },
      },
      handler: async (response) => {
        finished = true;
        const mapped = mapRazorpaySuccess(response, start.razorpaySubscriptionId);
        if (!mapped.ok) {
          setState({ kind: "error", message: "We could not read the payment confirmation. Contact support if you were charged." });
          return;
        }
        setState({ kind: "busy", label: "Confirming your payment…" });
        try {
          const res = await fetch("/api/checkout/razorpay/verify", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(mapped.payload),
          });
          const body: unknown = await res.json().catch(() => undefined);
          if (!res.ok) {
            const error = parseErrorBody(res.status, body);
            setState({ kind: "error", message: userMessage(error), code: error.code });
            return;
          }
          onVerified(body as SubscriptionView);
        } catch {
          setState({
            kind: "error",
            message: "We could not confirm the payment. If you were charged, your subscription will activate shortly.",
          });
        }
      },
    });
    checkout.on("payment.failed", () => {
      setState({ kind: "error", message: "The payment did not go through. You can try again in the payment window." });
    });
    setState({ kind: "checkout" });
    checkout.open();
  }

  async function simulate() {
    if (!fakeProductId) return;
    setState({ kind: "busy", label: "Simulating purchase…" });
    const result = await simulatePurchase(fakeProductId);
    if (!result.ok) {
      setState({ kind: "error", message: result.message, code: result.code });
      return;
    }
    onVerified(result.subscription);
  }

  if (!signedIn) {
    return (
      <div className={styles.actions}>
        <Link href={`/login?next=${encodeURIComponent("/subscribe")}`} className="btn btn-primary">
          Sign in to subscribe
        </Link>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.actions}>
        <button type="button" className="btn btn-primary" onClick={subscribe} disabled={busy} data-testid="subscribe">
          {state.kind === "busy" ? state.label : "Subscribe"}
        </button>
        {fakeProductId ? (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={simulate}
            disabled={busy}
            data-testid="simulate-purchase"
          >
            Simulate purchase (dev)
          </button>
        ) : null}
      </div>
      <div aria-live="polite" className={styles.status}>
        {state.kind === "dismissed" ? (
          <p className="alert">Checkout closed. You have not been charged.</p>
        ) : state.kind === "success" ? (
          <p className="alert alert-success" data-testid="purchase-success">
            {state.message}
          </p>
        ) : state.kind === "error" ? (
          <p className="alert alert-error" data-testid="purchase-error" data-code={state.code}>
            {state.message}
          </p>
        ) : null}
      </div>
    </div>
  );
}
