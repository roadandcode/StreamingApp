import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

/**
 * Smoke tests run against an admin dashboard that is already running (default
 * http://localhost:3001) and talks to the API at API_BASE_URL.
 *
 * With E2E_USE_MOCK=1 Playwright instead starts the in-memory mock API on :3100 and the built
 * dashboard (`pnpm build` first) pointed at it, and stops both afterwards.
 */
const useMock = process.env.E2E_USE_MOCK === "1";
const MOCK_API_URL = "http://localhost:3100";

if (useMock) {
  process.env.API_BASE_URL ??= MOCK_API_URL;
  process.env.E2E_ADMIN_EMAIL ??= "admin@example.test";
  process.env.E2E_ADMIN_PASSWORD ??= "admin-password-123";
  process.env.E2E_VIEWER_EMAIL ??= "viewer@example.test";
  process.env.E2E_VIEWER_PASSWORD ??= "viewer-password-123";
}

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3001";
const chromiumPath = process.env.E2E_CHROMIUM_PATH;

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: chromiumPath ? { executablePath: chromiumPath } : {},
      },
    },
  ],
  webServer: useMock
    ? [
        {
          command: "node e2e/mock-api.mjs",
          url: `${MOCK_API_URL}/v1/health`,
          reuseExistingServer: false,
          env: { MOCK_QUIET: "1" },
        },
        {
          command: "pnpm start",
          url: `${baseURL}/login`,
          reuseExistingServer: false,
          env: {
            API_BASE_URL: process.env.API_BASE_URL ?? MOCK_API_URL,
            // Throwaway key for this test run only.
            SESSION_COOKIE_SECRET: randomBytes(32).toString("base64url"),
          },
        },
      ]
    : undefined,
});
