import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

/**
 * Smoke tests for the viewer website.
 *
 * - Default: starts the contract-faithful mock API (e2e/mock-api.mjs, port 3200) and the built app
 *   (`next start`, port 3002) pointed at it. Run `pnpm build` first.
 * - Real API: set API_BASE_URL (for example http://localhost:3000). The mock still starts, but only
 *   to serve its small VP9 test stream; see README.md.
 */

const MOCK_URL = "http://localhost:3200";
const realApi = process.env.API_BASE_URL;
const apiBaseUrl = realApi ?? MOCK_URL;
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3002";
const mediaOrigins = process.env.MEDIA_ORIGINS ?? [...new Set([new URL(apiBaseUrl).origin, MOCK_URL])].join(",");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "node e2e/mock-api.mjs",
      url: `${MOCK_URL}/v1/health`,
      reuseExistingServer: false,
      stdout: "pipe",
      env: {
        MOCK_API_PORT: "3200",
        // Fast heartbeats, and access tokens short enough that every request goes through refresh.
        MOCK_HEARTBEAT_INTERVAL_SECONDS: process.env.MOCK_HEARTBEAT_INTERVAL_SECONDS ?? "2",
        MOCK_ACCESS_TOKEN_TTL_SECONDS: process.env.MOCK_ACCESS_TOKEN_TTL_SECONDS ?? "20",
      },
    },
    {
      command: "pnpm exec next start -p 3002",
      url: `${baseURL}/robots.txt`,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "pipe",
      env: {
        API_BASE_URL: apiBaseUrl,
        SESSION_COOKIE_SECRET: process.env.SESSION_COOKIE_SECRET ?? randomBytes(32).toString("hex"),
        NEXT_PUBLIC_FAKE_BILLING: "true",
        REQUIRE_DRM: "false",
        WEB_MAX_VIDEO_HEIGHT: "720",
        NEXT_PUBLIC_SITE_URL: baseURL,
        MEDIA_ORIGINS: mediaOrigins,
      },
    },
  ],
});
