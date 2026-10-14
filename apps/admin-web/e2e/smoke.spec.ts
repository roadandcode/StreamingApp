import { randomUUID } from "node:crypto";
import { expect, request, test, type Page } from "@playwright/test";

/**
 * Admin dashboard smoke test. Runs against a real API (or the mock in e2e/mock-api.mjs):
 *
 *   API_BASE_URL                         API the dashboard and this test talk to
 *   E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD   an admin account
 *   E2E_VIEWER_EMAIL / E2E_VIEWER_PASSWORD a viewer (non-admin) account
 *   E2E_BASE_URL                          the dashboard, default http://localhost:3001
 */

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Set ${name} to run the admin smoke test (see apps/admin-web/.env.example).`);
  }
  return value;
}

const apiBaseUrl = requiredEnv("API_BASE_URL").replace(/\/+$/, "");
const admin = { email: requiredEnv("E2E_ADMIN_EMAIL"), password: requiredEnv("E2E_ADMIN_PASSWORD") };
const viewer = { email: requiredEnv("E2E_VIEWER_EMAIL"), password: requiredEnv("E2E_VIEWER_PASSWORD") };

const DEVICE_PREFIX = "E2E device";

async function signIn(page: Page, credentials: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(credentials.email);
  await page.getByLabel("Password").fill(credentials.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

/**
 * Registers a fresh device for the viewer through the public API so the admin has one to revoke.
 * Devices left by earlier runs are removed first to stay under the per-user device limit.
 */
async function registerViewerDevice(name: string): Promise<void> {
  const api = await request.newContext();
  try {
    const login = await api.post(`${apiBaseUrl}/v1/auth/login`, { data: viewer });
    expect(login.status(), await login.text()).toBe(200);
    const { tokens } = (await login.json()) as { tokens: { accessToken: string; refreshToken: string } };
    const headers = { Authorization: `Bearer ${tokens.accessToken}` };

    const existing = await api.get(`${apiBaseUrl}/v1/me/devices`, { headers });
    expect(existing.status(), await existing.text()).toBe(200);
    for (const device of (await existing.json()) as { id: string; name: string }[]) {
      if (device.name.startsWith(DEVICE_PREFIX)) {
        await api.delete(`${apiBaseUrl}/v1/me/devices/${device.id}`, { headers });
      }
    }

    const created = await api.post(`${apiBaseUrl}/v1/me/devices`, {
      headers,
      data: { installationId: randomUUID(), platform: "android", name },
    });
    expect(created.status(), await created.text()).toBe(201);

    await api.post(`${apiBaseUrl}/v1/auth/logout`, { data: { refreshToken: tokens.refreshToken } });
  } finally {
    await api.dispose();
  }
}

test("admin manages content and supports a user", async ({ page }) => {
  const stamp = Date.now().toString(36);
  const courseTitle = `E2E course ${stamp}`;
  const lessonTitle = `E2E lesson ${stamp}`;
  const deviceName = `${DEVICE_PREFIX} ${stamp}`;

  await test.step("sign in as admin", async () => {
    await signIn(page, admin);
    await expect(page).toHaveURL(/\/content$/);
    await expect(page.getByTestId("signed-in-as")).toHaveText(admin.email);
  });

  await test.step("content list", async () => {
    await expect(page.getByRole("heading", { level: 1, name: "Content" })).toBeVisible();
    await expect(page.getByRole("form", { name: "Filter content" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Pagination" })).toBeVisible();
  });

  await test.step("create a course", async () => {
    await page.getByRole("link", { name: "New course", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "New course" })).toBeVisible();
    await page.getByLabel("Title").fill(courseTitle);
    await page.getByLabel("Description").fill("Created by the admin smoke test.");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: courseTitle })).toBeVisible();
    await expect(page.getByTestId("publication-status")).toHaveText("Draft");
  });
  const courseUrl = page.url();

  await test.step("add a lesson", async () => {
    await page.getByRole("link", { name: "Add lesson", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "New lesson" })).toBeVisible();
    await expect(page.getByText(`Course: ${courseTitle}`)).toBeVisible();
    await page.getByLabel("Title").fill(lessonTitle);
    await page.getByLabel("Description").fill("First lesson of the smoke test course.");
    await page.getByRole("button", { name: "Create lesson", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: lessonTitle })).toBeVisible();
  });

  await test.step("publishing is blocked before a video is uploaded", async () => {
    await expect(page.getByRole("button", { name: "Publish", exact: true })).toBeDisabled();
    await expect(page.getByText("Upload a video and wait until it is ready before publishing.")).toBeVisible();
  });

  await test.step("upload a small video file", async () => {
    await page.getByLabel("Video file").setInputFiles({
      name: "smoke-test.mp4",
      mimeType: "video/mp4",
      buffer: Buffer.alloc(256 * 1024, 7),
    });
    await page.getByRole("button", { name: "Upload video", exact: true }).click();
    await expect(page.getByText("The video is ready.")).toBeVisible({ timeout: 90_000 });
  });

  await test.step("publish the lesson", async () => {
    const publish = page.getByRole("button", { name: "Publish", exact: true });
    await expect(publish).toBeEnabled();
    await publish.click();
    await expect(page.getByTestId("publication-status")).toHaveText("Published");
    await expect(page.getByRole("button", { name: "Unpublish", exact: true })).toBeVisible();
  });

  await test.step("the lesson is listed on its course", async () => {
    await page.goto(courseUrl);
    await expect(page.getByRole("link", { name: lessonTitle, exact: true })).toBeVisible();
  });

  await test.step("give the viewer a device to revoke", async () => {
    await registerViewerDevice(deviceName);
  });

  await test.step("search for the user", async () => {
    await page.getByRole("link", { name: "Users", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Users" })).toBeVisible();
    await page.getByLabel("Email").fill(viewer.email);
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page.getByRole("link", { name: viewer.email, exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: viewer.email })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Subscription" })).toBeVisible();
  });

  await test.step("revoke the device", async () => {
    const row = page.getByTestId("device-row").filter({ hasText: deviceName });
    await expect(row).toContainText("Active");
    page.once("dialog", (dialog) => void dialog.accept());
    await row.getByRole("button", { name: "Revoke device", exact: true }).click();
    await expect(row).toContainText("Revoked");
    await expect(row.getByRole("button", { name: "Revoke device", exact: true })).toHaveCount(0);
  });

  await test.step("sign out", async () => {
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/content");
    await expect(page).toHaveURL(/\/login/);
  });
});

test("non-admin login is rejected", async ({ page }) => {
  await signIn(page, viewer);
  await expect(page.getByText("This account does not have admin access.")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);

  await page.goto("/content");
  await expect(page).toHaveURL(/\/login/);
});

test("content form shows field-level validation errors", async ({ page }) => {
  await signIn(page, admin);
  await expect(page).toHaveURL(/\/content$/);

  await page.goto("/content/new?kind=video");
  await page.getByLabel("Title").fill("Validation check");
  await page.getByLabel("Description").fill("This item should not be created.");
  await page.getByLabel("Default language").fill("Hindi");
  await page.getByLabel("Regions").fill("India");
  await page.getByRole("button", { name: "Create", exact: true }).click();

  await expect(page.getByText("Use two-letter ISO country codes such as IN or NP")).toBeVisible();
  await expect(page.getByText("Use a language code such as hi, en or ta-IN.")).toBeVisible();
  await expect(page.getByLabel("Regions")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("Title")).toHaveValue("Validation check");
  await expect(page).toHaveURL(/\/content\/new/);
});
