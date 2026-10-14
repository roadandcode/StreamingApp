import { describe, expect, it } from "vitest";
import { ConfigError, parseConfig } from "./config";

const SECRET = "x".repeat(32);

describe("parseConfig", () => {
  it("applies the documented defaults", () => {
    expect(parseConfig({ SESSION_COOKIE_SECRET: SECRET })).toEqual({
      apiBaseUrl: "http://localhost:3000",
      sessionCookieSecret: SECRET,
      fakeBilling: false,
      requireDrm: false,
      maxVideoHeight: 720,
      siteUrl: "http://localhost:3002",
      mediaOrigins: ["http://localhost:3000"],
      trustedCountryHeader: null,
      isProduction: false,
    });
  });

  it("reads every option", () => {
    const config = parseConfig({
      API_BASE_URL: "https://api.example.in/",
      SESSION_COOKIE_SECRET: SECRET,
      NEXT_PUBLIC_FAKE_BILLING: "true",
      REQUIRE_DRM: "1",
      WEB_MAX_VIDEO_HEIGHT: "480",
      NEXT_PUBLIC_SITE_URL: "https://www.example.in",
      MEDIA_ORIGINS: "https://cdn.example.in, https://license.example.com/path",
      TRUSTED_COUNTRY_HEADER: "CloudFront-Viewer-Country",
      NODE_ENV: "production",
    });
    expect(config).toMatchObject({
      apiBaseUrl: "https://api.example.in",
      fakeBilling: true,
      requireDrm: true,
      maxVideoHeight: 480,
      siteUrl: "https://www.example.in",
      mediaOrigins: ["https://cdn.example.in", "https://license.example.com"],
      trustedCountryHeader: "cloudfront-viewer-country",
      isProduction: true,
    });
  });

  it("refuses a missing or short session secret and lists every problem", () => {
    try {
      parseConfig({ SESSION_COOKIE_SECRET: "short", REQUIRE_DRM: "yes", WEB_MAX_VIDEO_HEIGHT: "abc" });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const problems = (error as ConfigError).problems.join("\n");
      expect(problems).toMatch(/SESSION_COOKIE_SECRET/);
      expect(problems).toMatch(/REQUIRE_DRM/);
      expect(problems).toMatch(/WEB_MAX_VIDEO_HEIGHT/);
    }
  });

  it("rejects invalid URLs", () => {
    expect(() => parseConfig({ SESSION_COOKIE_SECRET: SECRET, API_BASE_URL: "ftp://x" })).toThrow(ConfigError);
    expect(() => parseConfig({ SESSION_COOKIE_SECRET: SECRET, MEDIA_ORIGINS: "not a url" })).toThrow(ConfigError);
  });
});
