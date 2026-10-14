import type { NextRequest } from "next/server";
import { ApiSession } from "@/lib/api/server";
import type { SubscriptionView } from "@/lib/api/types";
import { parseRazorpayVerifyBody } from "@/lib/checkout/razorpay";
import { errorResponse, jsonResponse, readJsonBody, rejectCrossOrigin, webError } from "@/lib/http/route";

/**
 * Receives Razorpay Checkout's three ids from the browser and asks the API to verify them
 * (`POST /v1/checkout/razorpay/verify`). The API checks the signature and the subscription owner.
 */
export async function POST(request: NextRequest) {
  const blocked = rejectCrossOrigin(request);
  if (blocked) return blocked;

  const body = parseRazorpayVerifyBody(await readJsonBody(request));
  if (!body) return errorResponse(webError(400, "BAD_REQUEST"));

  const api = await ApiSession.load();
  if (!api.data) return errorResponse(webError(401, "UNAUTHENTICATED"));

  try {
    const subscription = await api.fetch<SubscriptionView>("/v1/checkout/razorpay/verify", {
      method: "POST",
      body,
    });
    return jsonResponse(subscription);
  } catch (error) {
    return errorResponse(error);
  }
}
