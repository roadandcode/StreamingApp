import type { RazorpayVerifyRequest } from "@/lib/api/types";

/**
 * Razorpay Checkout helpers for the browser. The flow (API contract, "Web checkout (Razorpay)"):
 * server action creates the subscription → Checkout opens with `key` + `subscription_id` →
 * the success handler's three ids go to our route handler → `POST /v1/checkout/razorpay/verify`.
 * The browser never decides access; the API verifies the signature with Razorpay's secret.
 */

export const RAZORPAY_CHECKOUT_SCRIPT = "https://checkout.razorpay.com/v1/checkout.js";

/** Shape of the object Razorpay passes to `handler` after a successful subscription payment. */
export interface RazorpaySuccessResponse {
  razorpay_payment_id?: unknown;
  razorpay_subscription_id?: unknown;
  razorpay_signature?: unknown;
}

const RAZORPAY_ID_RE = /^[A-Za-z0-9_]{1,128}$/;
const SIGNATURE_RE = /^[A-Fa-f0-9]{16,256}$/;

export type MappedRazorpaySuccess =
  | { ok: true; payload: RazorpayVerifyRequest }
  | { ok: false; reason: "malformed" | "subscription_mismatch" };

/**
 * Maps Checkout's success response to the API's verify body. Rejects malformed responses and a
 * subscription id that differs from the one this checkout was opened with.
 */
export function mapRazorpaySuccess(response: unknown, expectedSubscriptionId: string): MappedRazorpaySuccess {
  if (typeof response !== "object" || response === null) return { ok: false, reason: "malformed" };
  const r = response as RazorpaySuccessResponse;
  const paymentId = r.razorpay_payment_id;
  const subscriptionId = r.razorpay_subscription_id;
  const signature = r.razorpay_signature;
  if (
    typeof paymentId !== "string" ||
    typeof subscriptionId !== "string" ||
    typeof signature !== "string" ||
    !RAZORPAY_ID_RE.test(paymentId) ||
    !RAZORPAY_ID_RE.test(subscriptionId) ||
    !SIGNATURE_RE.test(signature)
  ) {
    return { ok: false, reason: "malformed" };
  }
  if (subscriptionId !== expectedSubscriptionId) return { ok: false, reason: "subscription_mismatch" };
  return {
    ok: true,
    payload: { razorpaySubscriptionId: subscriptionId, razorpayPaymentId: paymentId, razorpaySignature: signature },
  };
}

/** Validates the verify body on the server (route handler). */
export function parseRazorpayVerifyBody(body: unknown): RazorpayVerifyRequest | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const keys = Object.keys(b);
  if (keys.length !== 3) return null;
  const { razorpaySubscriptionId, razorpayPaymentId, razorpaySignature } = b;
  if (
    typeof razorpaySubscriptionId !== "string" ||
    typeof razorpayPaymentId !== "string" ||
    typeof razorpaySignature !== "string" ||
    !RAZORPAY_ID_RE.test(razorpaySubscriptionId) ||
    !RAZORPAY_ID_RE.test(razorpayPaymentId) ||
    !SIGNATURE_RE.test(razorpaySignature)
  ) {
    return null;
  }
  return { razorpaySubscriptionId, razorpayPaymentId, razorpaySignature };
}

export interface RazorpayOptions {
  key: string;
  subscription_id: string;
  name: string;
  description?: string;
  prefill?: { email?: string; name?: string };
  theme?: { color?: string };
  handler: (response: RazorpaySuccessResponse) => void;
  modal?: { ondismiss?: () => void; escape?: boolean; confirm_close?: boolean };
}

export interface RazorpayInstance {
  open(): void;
  on(event: "payment.failed", callback: (response: { error?: { description?: string } }) => void): void;
}

export type RazorpayConstructor = new (options: RazorpayOptions) => RazorpayInstance;

let loading: Promise<RazorpayConstructor> | null = null;

/** Loads Razorpay Checkout once. Allowed by the CSP through 'strict-dynamic'. */
export function loadRazorpayCheckout(): Promise<RazorpayConstructor> {
  const w = window as Window & { Razorpay?: RazorpayConstructor };
  if (w.Razorpay) return Promise.resolve(w.Razorpay);
  if (loading) return loading;
  loading = new Promise<RazorpayConstructor>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = RAZORPAY_CHECKOUT_SCRIPT;
    script.async = true;
    script.onload = () => {
      if (w.Razorpay) resolve(w.Razorpay);
      else reject(new Error("Razorpay Checkout did not initialise"));
    };
    script.onerror = () => {
      loading = null;
      script.remove();
      reject(new Error("Razorpay Checkout could not be loaded"));
    };
    document.head.appendChild(script);
  });
  return loading;
}
