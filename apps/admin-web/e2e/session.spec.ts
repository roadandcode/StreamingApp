import { expect, test } from "@playwright/test";
import { isMockApi, mockControl, signInAsAdmin } from "./support";

/**
 * Session renewal paths that need the API to reject tokens on demand. They use the test controls
 * of e2e/mock-api.mjs and are skipped against a real API.
 */

test.describe("session renewal", () => {
  test.beforeAll(async () => {
    test.skip(!(await isMockApi()), "Needs the mock API test controls (run with E2E_USE_MOCK=1).");
  });

  test("a rejected access token is renewed without signing out", async ({ page }) => {
    await signInAsAdmin(page);

    // Page render: the API rejects the token, the dashboard refreshes it and comes back.
    expect((await mockControl("POST", "expire-access-tokens")).status).toBe(204);
    await page.goto("/content?status=published");
    await expect(page).toHaveURL(/\/content\?status=published$/);
    await expect(page.getByRole("heading", { level: 1, name: "Content" })).toBeVisible();

    // Server action: refreshes inline and retries the call once.
    expect((await mockControl("POST", "expire-access-tokens")).status).toBe(204);
    await page.goto("/content/new?kind=video");
    const title = `Session renewal ${Date.now().toString(36)}`;
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Description").fill("Created right after the access token was rejected.");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  });

  test("a revoked session sends the admin back to sign in", async ({ page }) => {
    await signInAsAdmin(page);

    expect((await mockControl("POST", "revoke-all-sessions")).status).toBe(204);
    await page.goto("/content?kind=course");
    await expect(page).toHaveURL(/\/login\?reason=expired/);
    await expect(page.getByText("Your session has expired. Please sign in again.")).toBeVisible();

    await page.goto("/users");
    await expect(page).toHaveURL(/\/login/);
  });
});
