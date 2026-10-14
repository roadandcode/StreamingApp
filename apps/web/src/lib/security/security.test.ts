import { describe, expect, it } from "vitest";
import { buildCsp } from "./csp";
import { isAllowedOrigin } from "./origin";

describe("isAllowedOrigin", () => {
  const allowed = ["https://www.example.in", "http://localhost:3002"];

  it("accepts same-site requests", () => {
    expect(isAllowedOrigin("https://www.example.in", "same-origin", allowed)).toBe(true);
    expect(isAllowedOrigin("http://localhost:3002", null, allowed)).toBe(true);
  });

  it("rejects cross-site and origin-less requests", () => {
    expect(isAllowedOrigin("https://evil.example", "cross-site", allowed)).toBe(false);
    expect(isAllowedOrigin("https://evil.example", null, allowed)).toBe(false);
    expect(isAllowedOrigin("https://www.example.in", "cross-site", allowed)).toBe(false);
    expect(isAllowedOrigin(null, null, allowed)).toBe(false);
    expect(isAllowedOrigin("null", null, allowed)).toBe(false);
    expect(isAllowedOrigin("https://www.example.in.evil.example", null, allowed)).toBe(false);
  });
});

describe("buildCsp", () => {
  const csp = buildCsp({
    nonce: "abc123",
    mediaOrigins: ["https://cdn.example.in", "https://license.example.com"],
    isDevelopment: false,
    upgradeInsecureRequests: true,
  });
  const directive = (name: string) => csp.split("; ").find((d) => d.startsWith(`${name} `)) ?? "";

  it("allows scripts only by nonce (plus Razorpay Checkout)", () => {
    expect(directive("script-src")).toBe(
      "script-src 'self' 'nonce-abc123' 'strict-dynamic' https://checkout.razorpay.com",
    );
    expect(csp).not.toContain("unsafe-eval");
  });

  it("allows media and licence origins from config and blob: for MSE", () => {
    expect(directive("media-src")).toBe("media-src 'self' blob: https://cdn.example.in https://license.example.com");
    expect(directive("connect-src")).toContain("https://license.example.com");
    expect(directive("connect-src")).toContain("https://api.razorpay.com");
  });

  it("allows Razorpay's checkout frame and blocks framing of our pages", () => {
    expect(directive("frame-src")).toBe("frame-src https://api.razorpay.com https://checkout.razorpay.com");
    expect(directive("frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive("object-src")).toBe("object-src 'none'");
    expect(csp.endsWith("upgrade-insecure-requests")).toBe(true);
  });

  it("adds what the development server needs", () => {
    const dev = buildCsp({ nonce: "n", mediaOrigins: [], isDevelopment: true, upgradeInsecureRequests: false });
    expect(dev).toContain("'unsafe-eval'");
    expect(dev).not.toContain("upgrade-insecure-requests");
  });
});
