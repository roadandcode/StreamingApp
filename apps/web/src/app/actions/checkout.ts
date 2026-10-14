"use server";

import { asApiError, userMessage } from "@/lib/api/errors";
import { ApiSession } from "@/lib/api/server";
import type { RazorpaySubscriptionCreated, SubscriptionView } from "@/lib/api/types";
import { getConfig } from "@/lib/config";

export type ActionFailure = { ok: false; code: string; message: string };

export type CheckoutStart =
  | { ok: true; keyId: string; razorpaySubscriptionId: string; planCode: string; email: string }
  | ActionFailure;

export type PurchaseResult = { ok: true; subscription: SubscriptionView } | ActionFailure;

const PLAN_CODE_RE = /^[a-z0-9_]{1,64}$/;
const FAKE_PRODUCT_RE = /^fake_[a-z0-9_]{1,60}$/;

function fail(error: unknown): ActionFailure {
  const apiError = asApiError(error);
  return { ok: false, code: apiError.code, message: userMessage(apiError.toBody()) };
}

function signedOut(): ActionFailure {
  return { ok: false, code: "UNAUTHENTICATED", message: "Sign in to subscribe." };
}

/**
 * Step 1 of web checkout: `POST /v1/checkout/razorpay/subscriptions`. Returns what Razorpay
 * Checkout needs (public key id and subscription id); no secret ever reaches the browser.
 */
export async function startRazorpayCheckout(planCode: string): Promise<CheckoutStart> {
  if (typeof planCode !== "string" || !PLAN_CODE_RE.test(planCode)) {
    return { ok: false, code: "BAD_REQUEST", message: "Unknown plan." };
  }
  const api = await ApiSession.load();
  if (!api.data) return signedOut();
  try {
    const created = await api.fetch<RazorpaySubscriptionCreated>("/v1/checkout/razorpay/subscriptions", {
      method: "POST",
      body: { planCode },
    });
    return {
      ok: true,
      keyId: created.keyId,
      razorpaySubscriptionId: created.razorpaySubscriptionId,
      planCode: created.planCode,
      email: api.data?.user.email ?? "",
    };
  } catch (error) {
    return fail(error);
  }
}

/**
 * Development only: verifies a fake purchase exactly like the mobile app does
 * (`POST /v1/purchases/verify` with `provider: "fake"`). The API refuses it outside fake billing.
 */
export async function simulatePurchase(productId: string): Promise<PurchaseResult> {
  if (!getConfig().fakeBilling) {
    return { ok: false, code: "FORBIDDEN", message: "Simulated purchases are disabled." };
  }
  if (typeof productId !== "string" || !FAKE_PRODUCT_RE.test(productId)) {
    return { ok: false, code: "BAD_REQUEST", message: "Unknown product." };
  }
  const api = await ApiSession.load();
  if (!api.data) return signedOut();
  try {
    const subscription = await api.fetch<SubscriptionView>("/v1/purchases/verify", {
      method: "POST",
      body: { provider: "fake", productId, receipt: crypto.randomUUID() },
    });
    return { ok: true, subscription };
  } catch (error) {
    return fail(error);
  }
}
