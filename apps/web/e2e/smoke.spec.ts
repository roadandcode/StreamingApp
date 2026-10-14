import { expect, test, type Page } from "@playwright/test";

/**
 * Viewer smoke test. Runs against the mock API by default, or against a real API when API_BASE_URL
 * is set (see README.md). Optional: E2E_VIEWER_EMAIL / E2E_VIEWER_PASSWORD to reuse an account
 * (registered on first use), E2E_COURSE_ID to pick the course.
 */

const usingMock = !process.env.API_BASE_URL;
const email = process.env.E2E_VIEWER_EMAIL ?? `viewer.${Date.now()}@example.com`;
const password = process.env.E2E_VIEWER_PASSWORD ?? "correct-horse-battery-staple";
// The mock sends heartbeats every 2 s; the API default is 30 s.
const heartbeatTimeout = usingMock ? 15_000 : 75_000;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function waitForDeviceOrNext(page: Page, nextPath: string): Promise<void> {
  await page.waitForURL((url) => url.pathname === nextPath || url.pathname === "/device", { timeout: 30_000 });
  const url = new URL(page.url());
  if (url.pathname !== "/device") return;
  // A reused account can be at its device limit: free a slot held by another browser.
  expect(url.searchParams.get("reason"), "device page reason").toBe("limit");
  await page.locator('[data-testid="device"][data-this-browser="false"] button').first().click();
  await page.waitForURL((u) => u.pathname === nextPath, { timeout: 30_000 });
}

async function signInOrRegister(page: Page, nextPath: string): Promise<void> {
  const next = encodeURIComponent(nextPath);
  if (process.env.E2E_VIEWER_EMAIL) {
    await page.goto(`/login?next=${next}`);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    const failed = await page
      .getByRole("alert")
      .filter({ hasText: "do not match" })
      .waitFor({ timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (!failed) {
      await waitForDeviceOrNext(page, nextPath);
      return;
    }
  }
  await page.goto(`/register?next=${next}`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await waitForDeviceOrNext(page, nextPath);
}

test("viewer journey: catalog, course page, sign-in, purchase, playback, devices, sign-out", async ({ page }) => {
  // 1. Landing page lists the catalog (server-rendered).
  await page.goto("/");
  await expect(page.getByTestId("content-card").first()).toBeVisible();
  await expect(page.getByText(/Free|Premium/).first()).toBeVisible();

  // 2. Course page: title, description, Open Graph tags and canonical URL.
  let coursePath: string;
  if (process.env.E2E_COURSE_ID) {
    coursePath = `/content/${process.env.E2E_COURSE_ID}`;
    await page.goto(coursePath);
  } else {
    const course = page.locator('[data-testid="content-card"][data-kind="course"]').first();
    coursePath = (await course.getAttribute("href")) ?? "";
    await course.click();
    await page.waitForURL(`**${coursePath}`);
  }
  const title = (await page.locator("h1").innerText()).trim();
  expect(title.length).toBeGreaterThan(0);
  await expect(page).toHaveTitle(new RegExp(escapeRegExp(title)));
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /.{10,}/);
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", title);
  await expect(page.locator('meta[property="og:description"]')).toHaveAttribute("content", /.{10,}/);
  const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
  expect(canonical).toMatch(new RegExp(`${escapeRegExp(coursePath)}$`));
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute("content", canonical!);

  // 3. Register (or sign in) and come back to the course.
  await signInOrRegister(page, coursePath);
  await expect(page.getByTestId("account-link")).toBeVisible();

  // 4. Premium lessons show a lock (hint only) unless this account already has access.
  const premiumLesson = page.locator('[data-testid="lesson"][data-tier="premium"]').first();
  await expect(premiumLesson, "the course needs a premium lesson").toBeVisible();
  const alreadySubscribed = (await premiumLesson.getByTestId("lock").count()) === 0;
  if (alreadySubscribed) {
    test.info().annotations.push({ type: "note", description: "Account already subscribed; purchase steps skipped." });
  } else {
    await expect(premiumLesson.getByTestId("lock")).toBeVisible();

    // 5. Plans page: Razorpay fails closed while not configured; fake billing grants access.
    await page.goto("/subscribe");
    const plan = page.locator('[data-testid="plan"]').filter({ has: page.getByTestId("simulate-purchase") }).first();
    await expect(plan).toBeVisible();

    await plan.getByTestId("subscribe").click();
    const razorpayOutcome = await Promise.race([
      plan.getByTestId("purchase-error").waitFor().then(() => "error" as const),
      page.locator("iframe.razorpay-checkout-frame").waitFor().then(() => "checkout" as const),
    ]);
    if (razorpayOutcome === "error") {
      const code = await plan.getByTestId("purchase-error").getAttribute("data-code");
      if (usingMock) expect(code).toBe("PROVIDER_NOT_CONFIGURED");
      if (code === "PROVIDER_NOT_CONFIGURED") {
        await expect(plan.getByTestId("purchase-error")).toContainText("Payments are not configured yet");
      }
    } else {
      // Razorpay test mode is configured: close Checkout without paying.
      await page.keyboard.press("Escape");
      await expect(plan.getByText("Checkout closed")).toBeVisible();
    }

    await plan.getByTestId("simulate-purchase").click();
    // The page re-renders from the API's SubscriptionView and shows the subscribed banner.
    await expect(page.getByTestId("already-subscribed")).toBeVisible();

    // 6. The lock is gone.
    await page.goto(coursePath);
    await expect(premiumLesson).toBeVisible();
    await expect(premiumLesson.getByTestId("lock")).toHaveCount(0);
  }

  // 7. Watch page: a playback session is created and heartbeats are sent.
  const sessionResponse = page.waitForResponse(
    (r) => r.url().endsWith("/api/playback/sessions") && r.request().method() === "POST",
  );
  await premiumLesson.getByTestId("play-lesson").click();
  await page.waitForURL("**/watch/**");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);

  const created = await sessionResponse;
  expect(created.status()).toBe(201);
  const authorization = (await created.json()) as { playbackSessionId: string; heartbeatIntervalSeconds: number };
  expect(authorization.playbackSessionId).toMatch(/^[0-9a-f-]{36}$/);

  const heartbeat = await page.waitForResponse(
    (r) => r.url().endsWith(`/api/playback/sessions/${authorization.playbackSessionId}/heartbeat`),
    { timeout: heartbeatTimeout },
  );
  expect(heartbeat.status()).toBe(200);
  expect(JSON.parse(heartbeat.request().postData() ?? "{}")).toHaveProperty("positionSeconds");
  await expect(page.getByTestId("watermark")).toHaveText(email);

  if (usingMock) {
    // The mock's VP9 test stream really plays: Shaka loaded the manifest and segments.
    await expect(page.getByTestId("player")).toHaveAttribute("data-state", "playing");
    await expect.poll(() => page.locator("video").evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThan(0);
    // A second heartbeat proves the interval keeps running (and token refresh keeps working).
    const second = await page.waitForResponse(
      (r) => r.url().endsWith(`/api/playback/sessions/${authorization.playbackSessionId}/heartbeat`),
      { timeout: heartbeatTimeout },
    );
    expect(second.status()).toBe(200);
  }

  // 8. Leaving the player ends the session; the account page lists this browser as a device.
  const endRequest = page.waitForRequest((r) =>
    r.url().endsWith(`/api/playback/sessions/${authorization.playbackSessionId}/end`),
  );
  await page.getByTestId("account-link").click();
  await page.waitForURL("**/account");
  await endRequest;
  const thisBrowser = page.locator('[data-testid="device"][data-this-browser="true"]');
  await expect(thisBrowser).toBeVisible();
  await expect(thisBrowser).toContainText("This browser");
  await expect(page.getByTestId("account-email")).toHaveText(email);
  await expect(page.getByTestId("subscription-status")).toHaveAttribute("data-has-access", "true");

  // 9. Sign out.
  await page.getByTestId("sign-out").click();
  await page.waitForURL((url) => url.pathname === "/");
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
  await page.goto("/account");
  await expect(page).toHaveURL(/\/login\?next=%2Faccount/);
});

test("device limit: a new browser can take the place of a removed one", async ({ browser }) => {
  // Each browser context is one device (its own installationId cookie). MAX_DEVICES defaults to 3.
  const maxDevices = Number(process.env.E2E_MAX_DEVICES ?? 3);
  const limitEmail = `devices.${Date.now()}@example.com`;
  const contexts = [];
  try {
    for (let i = 0; i <= maxDevices; i += 1) {
      const context = await browser.newContext();
      contexts.push(context);
      const page = await context.newPage();
      if (i === 0) {
        await page.goto("/register?next=%2Faccount");
        await page.getByLabel("Email").fill(limitEmail);
        await page.getByLabel("Password").fill(password);
        await page.getByRole("button", { name: "Create account" }).click();
      } else {
        await page.goto("/login?next=%2Faccount");
        await page.getByLabel("Email").fill(limitEmail);
        await page.getByLabel("Password").fill(password);
        await page.getByRole("button", { name: "Sign in" }).click();
      }
      await page.waitForURL((url) => url.pathname === "/account" || url.pathname === "/device");

      if (i < maxDevices) {
        await expect(page).toHaveURL(/\/account$/);
        continue;
      }
      // One browser too many: 409 DEVICE_LIMIT_REACHED leads to the device page.
      await expect(page).toHaveURL(/\/device\?reason=limit/);
      await expect(page.getByTestId("device-limit")).toBeVisible();
      await expect(page.getByTestId("device")).toHaveCount(maxDevices);
      await expect(page.locator('[data-testid="device"][data-this-browser="true"]')).toHaveCount(0);

      await page.getByRole("button", { name: /Remove and use this browser/ }).first().click();
      await page.waitForURL((url) => url.pathname === "/account");
      await expect(page.getByTestId("device")).toHaveCount(maxDevices);
      await expect(page.locator('[data-testid="device"][data-this-browser="true"]')).toHaveCount(1);
    }
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test("a long-hidden tab pauses heartbeats and starts a new session when the viewer returns", async ({ page }) => {
  test.skip(!usingMock, "needs the mock's 2-second heartbeat interval to make the session stale quickly");

  await page.goto("/register?next=%2F");
  await page.getByLabel("Email").fill(`hidden.${Date.now()}@example.com`);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL((url) => url.pathname === "/");

  const setVisibility = (state: "hidden" | "visible") =>
    page.evaluate((value) => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => value });
      Object.defineProperty(document, "hidden", { configurable: true, get: () => value === "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    }, state);

  await page.clock.install();
  const firstSession = page.waitForResponse((r) => r.url().endsWith("/api/playback/sessions") && r.status() === 201);
  // A free lesson: no subscription needed.
  await page.goto("/watch/0b5c2a38-7f43-4c55-9a62-1f0c7d3e9a02");
  const first = (await (await firstSession).json()) as { playbackSessionId: string };
  await expect(page.getByTestId("player")).toHaveAttribute("data-state", "playing");

  // Hidden for longer than the pause threshold: heartbeats stop and the video pauses.
  await setVisibility("hidden");
  await page.clock.fastForward("06:00");
  await expect(page.getByTestId("player")).toHaveAttribute("data-state", "paused-hidden");

  // Let the session go stale on the server (3 x 2-second heartbeat interval).
  await page.waitForTimeout(7_000);

  const staleHeartbeat = page.waitForResponse((r) =>
    r.url().endsWith(`/api/playback/sessions/${first.playbackSessionId}/heartbeat`),
  );
  const secondSession = page.waitForResponse((r) => r.url().endsWith("/api/playback/sessions") && r.status() === 201);
  await setVisibility("visible");

  const stale = await staleHeartbeat;
  expect(stale.status()).toBe(403);
  expect(await stale.json()).toMatchObject({ code: "PLAYBACK_SESSION_ENDED" });
  const second = (await (await secondSession).json()) as { playbackSessionId: string };
  expect(second.playbackSessionId).not.toBe(first.playbackSessionId);
  await expect(page.getByTestId("player")).toHaveAttribute("data-state", "playing");
});

test("robots.txt, sitemap.xml and security headers", async ({ request, baseURL }) => {
  const robots = await request.get("/robots.txt");
  expect(robots.ok()).toBe(true);
  const robotsText = await robots.text();
  for (const path of ["/account", "/subscribe", "/watch/"]) expect(robotsText).toContain(`Disallow: ${path}`);
  expect(robotsText).toContain(`Sitemap: ${baseURL}/sitemap.xml`);

  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.ok()).toBe(true);
  const sitemapText = await sitemap.text();
  expect(sitemapText).toContain(`<loc>${baseURL}/</loc>`);
  expect(sitemapText).toMatch(/<loc>[^<]+\/content\/[0-9a-f-]{36}<\/loc>/);
  expect(sitemapText).not.toMatch(/\/(watch|account|subscribe)/);

  const home = await request.get("/");
  const headers = home.headers();
  expect(headers["content-security-policy"]).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["permissions-policy"]).toContain("camera=()");

  for (const path of ["/watch/0b5c2a38-7f43-4c55-9a62-1f0c7d3e9a02", "/account", "/subscribe"]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.headers()["x-robots-tag"], path).toContain("noindex");
  }

  // Mutating route handlers refuse cross-site requests.
  const forged = await request.post("/api/playback/sessions", {
    headers: { origin: "https://evil.example" },
    data: { contentId: "0b5c2a38-7f43-4c55-9a62-1f0c7d3e9a02" },
  });
  expect(forged.status()).toBe(403);
  expect(await forged.json()).toMatchObject({ statusCode: 403, code: "INVALID_ORIGIN" });
});
