import { describe, expect, it } from "vitest";
import { mapRazorpaySuccess, parseRazorpayVerifyBody } from "./razorpay";

const SIGNATURE = "9ef4dffbfd84f1318f6739a3ce19f9d85851857ae648f114332d8401e0949a3d";

describe("mapRazorpaySuccess", () => {
  it("maps Checkout's snake_case success response to the API's verify body", () => {
    const result = mapRazorpaySuccess(
      {
        razorpay_payment_id: "pay_29QQoUBi66xm2f",
        razorpay_subscription_id: "sub_00000000000001",
        razorpay_signature: SIGNATURE,
      },
      "sub_00000000000001",
    );
    expect(result).toEqual({
      ok: true,
      payload: {
        razorpaySubscriptionId: "sub_00000000000001",
        razorpayPaymentId: "pay_29QQoUBi66xm2f",
        razorpaySignature: SIGNATURE,
      },
    });
  });

  it("ignores extra fields Razorpay may add", () => {
    const result = mapRazorpaySuccess(
      {
        razorpay_payment_id: "pay_1",
        razorpay_subscription_id: "sub_1",
        razorpay_signature: SIGNATURE,
        org_logo: "",
      },
      "sub_1",
    );
    expect(result.ok && Object.keys(result.payload)).toEqual([
      "razorpaySubscriptionId",
      "razorpayPaymentId",
      "razorpaySignature",
    ]);
  });

  it("rejects a response for a different subscription", () => {
    expect(
      mapRazorpaySuccess(
        { razorpay_payment_id: "pay_1", razorpay_subscription_id: "sub_other", razorpay_signature: SIGNATURE },
        "sub_1",
      ),
    ).toEqual({ ok: false, reason: "subscription_mismatch" });
  });

  it.each([
    ["missing signature", { razorpay_payment_id: "pay_1", razorpay_subscription_id: "sub_1" }],
    ["non-string id", { razorpay_payment_id: 42, razorpay_subscription_id: "sub_1", razorpay_signature: SIGNATURE }],
    ["injected characters", { razorpay_payment_id: "pay_1/../x", razorpay_subscription_id: "sub_1", razorpay_signature: SIGNATURE }],
    ["non-hex signature", { razorpay_payment_id: "pay_1", razorpay_subscription_id: "sub_1", razorpay_signature: "not-a-signature!" }],
    ["null", null],
  ])("rejects a malformed response (%s)", (_name, response) => {
    expect(mapRazorpaySuccess(response, "sub_1")).toEqual({ ok: false, reason: "malformed" });
  });
});

describe("parseRazorpayVerifyBody", () => {
  const body = { razorpaySubscriptionId: "sub_1", razorpayPaymentId: "pay_1", razorpaySignature: SIGNATURE };

  it("accepts exactly the three ids", () => {
    expect(parseRazorpayVerifyBody(body)).toEqual(body);
  });

  it("rejects unknown fields so the browser cannot assert anything else", () => {
    expect(parseRazorpayVerifyBody({ ...body, status: "active" })).toBeNull();
  });

  it("rejects missing or invalid values", () => {
    expect(parseRazorpayVerifyBody({ ...body, razorpaySignature: "" })).toBeNull();
    expect(parseRazorpayVerifyBody(undefined)).toBeNull();
  });
});
