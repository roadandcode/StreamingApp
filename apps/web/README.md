# Viewer website (`@streamingapp/web`)

The public website: server-rendered catalog and course pages, sign-in, Razorpay subscriptions and a
Shaka Player web player. It builds strictly against
[`docs/architecture/api-contract.md`](../../docs/architecture/api-contract.md).

## Run it

```bash
cp apps/web/.env.example apps/web/.env.local     # then set SESSION_COOKIE_SECRET (openssl rand -hex 32)
pnpm --filter @streamingapp/web dev               # http://localhost:3002
```

| Script | What it does |
|---|---|
| `dev` / `build` / `start` | Next.js on port 3002 |
| `lint` | ESLint (Next.js core-web-vitals + TypeScript rules) |
| `typecheck` | `next typegen` + `tsc --noEmit` |
| `test` | Vitest unit tests (`src/**/*.test.ts`) |
| `test:e2e` | Playwright smoke tests (`e2e/`); run `build` first |

Configuration is validated when the server starts (see `.env.example`); an invalid value stops it.

## How it is put together

- **Backend for frontend.** The browser never talks to the API except for media, DRM licences and
  Razorpay Checkout. Sign-in, registration and every other call go through server actions and route
  handlers (`src/app/actions`, `src/app/api`), which keep the API tokens in an encrypted, httpOnly,
  SameSite=Lax cookie (`Secure` in production). `proxy.ts` refreshes tokens before pages render
  (server components cannot set cookies); route handlers and actions refresh on expiry or
  `401 UNAUTHENTICATED`. Concurrent refreshes of the same token share one API call, because a reused
  refresh token revokes the whole session family.
- **Devices.** Each browser gets a random `installationId` in a long-lived httpOnly cookie and is
  registered with `platform: "web"` on sign-in. `409 DEVICE_LIMIT_REACHED` leads to `/device`, where
  the viewer removes a device and the browser is registered again; `403 DEVICE_REVOKED` (an admin
  block) is explained there and never worked around.
- **Player.** `src/lib/player`: DRM detection with `requestMediaKeySystemAccess`, a pure DRM
  configuration builder (licence headers passed through exactly as the API returns them), heartbeats,
  stop on any 403, a new session after `PLAYBACK_SESSION_ENDED` on return to a long-hidden tab, and
  `sendBeacon` to end the session when the viewer leaves. `REQUIRE_DRM` refuses `drm: null` (in the
  route handler and again in the player). The resolution cap (`WEB_MAX_VIDEO_HEIGHT`) is only a
  player restriction: enforce the real cap in packaging and in the DRM licence policy.
- **Lock icons are hints.** They come from `/v1/me/subscription`'s `hasAccess`; the API authorizes
  every playback.
- **Prices.** The API does not return prices. Set the INR display labels in
  `src/config/plan-prices.ts` to match the Razorpay plans.
- **Security headers.** A per-request nonce Content-Security-Policy (`proxy.ts`,
  `src/lib/security/csp.ts`) allows scripts from this site and Razorpay Checkout only, and media from
  `MEDIA_ORIGINS`; plus `X-Frame-Options`, `Referrer-Policy` and `Permissions-Policy`.

## End-to-end tests

`pnpm --filter @streamingapp/web build && pnpm --filter @streamingapp/web test:e2e`

By default Playwright starts `e2e/mock-api.mjs` (an in-memory API that follows the contract, port
3200) and the built app on port 3002 pointed at it. The mock serves a small VP9 test stream, so the
player really plays. Its access tokens live 20 seconds, so every request also exercises refresh.

Against a real API (fake media and billing providers):

1. Start the API with `BILLING_MODE=fake`, `MEDIA_PROVIDER=fake`, the default `CORS_ORIGINS`, and
   `FAKE_SAMPLE_MANIFEST_URL=http://localhost:3200/sample/master.m3u8`. Playwright's Chromium cannot
   decode H.264, so the API's default sample stream would fail to play; the mock (still started, but
   only used for this stream) serves a VP9 one.
2. Make sure the seeded catalog has a course with at least one premium lesson.
3. Run:

   ```bash
   API_BASE_URL=http://localhost:3000 pnpm --filter @streamingapp/web test:e2e
   ```

Optional variables: `E2E_VIEWER_EMAIL` / `E2E_VIEWER_PASSWORD` (reuse one account; it is registered
on first use), `E2E_COURSE_ID` (course to open), `E2E_MAX_DEVICES` (the API's `MAX_DEVICES`),
`MEDIA_ORIGINS` (defaults to the API origin plus the mock).
