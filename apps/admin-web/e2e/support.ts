import { expect, request, type Page } from "@playwright/test";

/** API the dashboard under test talks to (the real API or e2e/mock-api.mjs). */
export const apiBaseUrl = (process.env.API_BASE_URL ?? "").replace(/\/+$/, "");

export const admin = { email: process.env.E2E_ADMIN_EMAIL ?? "", password: process.env.E2E_ADMIN_PASSWORD ?? "" };

export async function signInAsAdmin(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(admin.email);
  await page.getByLabel("Password").fill(admin.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/content$/);
}

/** Calls a test control of e2e/mock-api.mjs; returns the HTTP status (0 when unreachable). */
export async function mockControl(
  method: "GET" | "POST",
  path: string,
  data?: unknown,
): Promise<{ status: number; body: unknown }> {
  const api = await request.newContext();
  try {
    const response = await api.fetch(`${apiBaseUrl}/__mock/${path}`, { method, data });
    const text = await response.text();
    return { status: response.status(), body: text ? (JSON.parse(text) as unknown) : undefined };
  } catch {
    return { status: 0, body: undefined };
  } finally {
    await api.dispose();
  }
}

/** True when API_BASE_URL is the mock API (its test controls answer). */
export async function isMockApi(): Promise<boolean> {
  return apiBaseUrl !== "" && (await mockControl("GET", "state")).status === 200;
}
