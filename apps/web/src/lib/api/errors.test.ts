import { describe, expect, it } from "vitest";
import { ApiError, asApiError, fieldErrorMap, parseErrorBody, toApiError, userMessage } from "./errors";

describe("toApiError", () => {
  it("maps the contract's error body", () => {
    const error = toApiError(403, {
      statusCode: 403,
      code: "ENTITLEMENT_REQUIRED",
      message: "An active subscription is required to watch this content.",
    });
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(403);
    expect(error.code).toBe("ENTITLEMENT_REQUIRED");
    expect(error.message).toBe("An active subscription is required to watch this content.");
    expect(error.fieldErrors).toEqual([]);
  });

  it("keeps field-level errors of VALIDATION_FAILED", () => {
    const error = toApiError(400, {
      statusCode: 400,
      code: "VALIDATION_FAILED",
      message: "Validation failed",
      errors: [
        { field: "password", message: "password must be longer than or equal to 10 characters" },
        { field: "regions.0", message: "invalid region" },
        { bogus: true },
      ],
    });
    expect(error.fieldErrors).toEqual([
      { field: "password", message: "password must be longer than or equal to 10 characters" },
      { field: "regions.0", message: "invalid region" },
    ]);
    expect(error.toBody()).toEqual({
      statusCode: 400,
      code: "VALIDATION_FAILED",
      message: "Validation failed",
      errors: error.fieldErrors,
    });
  });

  it("falls back to a friendly message when the API sends none", () => {
    const error = toApiError(503, { statusCode: 503, code: "PROVIDER_NOT_CONFIGURED" });
    expect(error.message).toBe("Payments are not configured yet. Please try again later.");
  });

  it.each([
    [401, "UNAUTHENTICATED"],
    [404, "NOT_FOUND"],
    [429, "RATE_LIMITED"],
    [502, "UNKNOWN_ERROR"],
  ])("maps a body-less %i to %s", (status, code) => {
    const error = toApiError(status, undefined);
    expect(error.status).toBe(status);
    expect(error.code).toBe(code);
  });

  it("ignores a non-error JSON body", () => {
    expect(toApiError(500, ["unexpected"]).code).toBe("UNKNOWN_ERROR");
  });
});

describe("asApiError", () => {
  it("passes ApiError through and turns anything else into NETWORK_ERROR", () => {
    const original = new ApiError(409, "DEVICE_LIMIT_REACHED", "limit");
    expect(asApiError(original)).toBe(original);
    const network = asApiError(new TypeError("fetch failed"));
    expect(network.code).toBe("NETWORK_ERROR");
    expect(network.status).toBe(503);
  });
});

describe("fieldErrorMap", () => {
  it("keys messages by top-level field, first message wins", () => {
    expect(
      fieldErrorMap([
        { field: "email", message: "email must be an email" },
        { field: "email", message: "second" },
        { field: "regions.1", message: "bad region" },
      ]),
    ).toEqual({ email: "email must be an email", regions: "bad region" });
  });
});

describe("messages", () => {
  it("prefers our wording for known codes and falls back to the API's message", () => {
    expect(userMessage({ code: "CONCURRENT_STREAM_LIMIT", message: "x" })).toMatch(/too many screens/);
    expect(userMessage({ code: "SOMETHING_NEW", message: "Server says hi" })).toBe("Server says hi");
  });

  it("parses route-handler error bodies", () => {
    expect(parseErrorBody(403, { statusCode: 403, code: "DRM_REQUIRED", message: "m" })).toEqual({
      statusCode: 403,
      code: "DRM_REQUIRED",
      message: "m",
    });
  });
});
