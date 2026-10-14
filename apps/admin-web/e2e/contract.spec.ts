import { expect, test, type Page } from "@playwright/test";
import { isMockApi, mockControl, signInAsAdmin } from "./support";

/**
 * Contract details that need the API to answer in a specific way. They use the test controls of
 * e2e/mock-api.mjs and are skipped against a real API.
 */

async function createVideo(page: Page, title: string) {
  await page.goto("/content/new?kind=video");
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Description").fill("Created by the contract checks.");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
}

async function uploadSmallFile(page: Page) {
  await page.getByLabel("Video file").setInputFiles({
    name: "contract-check.mp4",
    mimeType: "video/mp4",
    buffer: Buffer.alloc(64 * 1024, 3),
  });
  await page.getByRole("button", { name: "Upload video", exact: true }).click();
  await expect(page.getByText("The video is ready.")).toBeVisible({ timeout: 60_000 });
}

async function lastUploadHeaders(): Promise<Record<string, string>> {
  const { status, body } = await mockControl("GET", "last-upload");
  expect(status).toBe(200);
  return (body as { headers: Record<string, string> }).headers;
}

test.describe("API contract details", () => {
  test.beforeAll(async () => {
    test.skip(!(await isMockApi()), "Needs the mock API test controls (run with E2E_USE_MOCK=1).");
  });

  test.afterAll(async () => {
    if (await isMockApi()) {
      await mockControl("POST", "upload-headers", { headers: {} });
    }
  });

  test("API validation errors appear next to their fields", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/content/new?kind=video");
    await page.getByLabel("Title").fill("Duplicate title");
    await page.getByLabel("Description").fill("The API will reject this.");

    const scripted = await mockControl("POST", "fail-next", {
      method: "POST",
      path: "/v1/admin/content",
      status: 400,
      body: {
        statusCode: 400,
        code: "VALIDATION_FAILED",
        message: "title is already used; IN is not licensed; slug is taken",
        errors: [
          { field: "title", message: "A video with this title already exists." },
          { field: "regions.0", message: "IN is not licensed for this video." },
          { field: "slug", message: "slug is taken" },
        ],
      },
    });
    expect(scripted.status).toBe(204);
    await page.getByRole("button", { name: "Create", exact: true }).click();

    await expect(page.locator("#title-error")).toHaveText("A video with this title already exists.");
    await expect(page.getByLabel("Title")).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#regions-error")).toHaveText("IN is not licensed for this video.");
    await expect(page.getByLabel("Regions")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByText("The API rejected the request: slug: slug is taken")).toBeVisible();
    await expect(page.getByLabel("Title")).toHaveValue("Duplicate title");
    await expect(page).toHaveURL(/\/content\/new/);
  });

  test("uploads send exactly the headers the API returned", async ({ page }) => {
    page.on("dialog", (dialog) => void dialog.accept());
    await signInAsAdmin(page);
    await createVideo(page, `Upload headers ${Date.now().toString(36)}`);

    // No headers returned: the browser must not add a Content-Type of its own.
    expect((await mockControl("POST", "upload-headers", { headers: {} })).status).toBe(204);
    await uploadSmallFile(page);
    const bare = await lastUploadHeaders();
    expect(bare["content-type"]).toBeUndefined();
    expect(bare["authorization"]).toBeUndefined();
    expect(bare["cookie"]).toBeUndefined();

    // Returned headers are sent unchanged (the mock rejects the upload otherwise). The panel
    // already says "ready" from the first upload, so wait for the second PUT to arrive.
    const signed = { "Content-Type": "application/octet-stream", "X-Upload-Check": "abc123" };
    expect((await mockControl("POST", "upload-headers", { headers: signed })).status).toBe(204);
    await page.getByLabel("Replace video").setInputFiles({
      name: "contract-check-2.mp4",
      mimeType: "video/mp4",
      buffer: Buffer.alloc(64 * 1024, 4),
    });
    await page.getByRole("button", { name: "Upload video", exact: true }).click();
    await expect.poll(async () => (await lastUploadHeaders())["x-upload-check"]).toBe("abc123");
    const sent = await lastUploadHeaders();
    expect(sent["content-type"]).toBe("application/octet-stream");
    await expect(page.getByText("The video is ready.")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/upload (link was rejected|failed)/i)).toHaveCount(0);
  });
});
