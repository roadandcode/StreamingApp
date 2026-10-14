# API contract (v1)

This is the shared contract between the API (`services/api`), the admin dashboard
(`apps/admin-web`) and the mobile app (`apps/mobile`). The API implements it; the clients build
against it. Change this file first, then the code, whenever the contract changes. The machine-readable
version is emitted by the API to `packages/api-contracts/openapi.json`.

## Conventions

- Base path: `/v1`. JSON bodies, `camelCase` field names.
- IDs are UUID strings. Timestamps are ISO-8601 strings in UTC (`2026-11-12T00:00:00.000Z`).
- Authenticated endpoints take `Authorization: Bearer <accessToken>`.
- Paginated lists take `page` (1-based, default 1) and `pageSize` (default 20, max 100) and return
  `{ "items": [...], "page": 1, "pageSize": 20, "total": 57 }`.
- Unknown request fields are rejected with `400 VALIDATION_FAILED`.

### Error format

Every error response has this shape:

```json
{
  "statusCode": 403,
  "code": "ENTITLEMENT_REQUIRED",
  "message": "An active subscription is required to watch this content."
}
```

`code` is stable and is what clients branch on; `message` is for humans and may change.
`400 VALIDATION_FAILED` responses also carry `errors: { field: string; message: string }[]`, where
`field` is the request field's path (for example `"title"` or `"regions.0"`), so forms can show
errors next to the right input.

| HTTP | `code` | When |
|---|---|---|
| 400 | `VALIDATION_FAILED` | Body/query failed validation |
| 400 | `INVALID_PURCHASE` | Store/provider rejected the purchase proof |
| 401 | `UNAUTHENTICATED` | Missing, invalid or expired access token |
| 401 | `INVALID_CREDENTIALS` | Wrong email or password |
| 401 | `INVALID_REFRESH_TOKEN` | Refresh token unknown, expired, revoked or reused |
| 401 | `INVALID_SIGNATURE` | Webhook or signed media URL failed verification |
| 403 | `FORBIDDEN` | Authenticated but lacks the role (e.g. non-admin on `/v1/admin/*`) |
| 403 | `ACCOUNT_INACTIVE` | Account suspended or deleted |
| 403 | `ENTITLEMENT_REQUIRED` | Premium content without an active entitlement |
| 403 | `REGION_NOT_ALLOWED` | Content not licensed for the viewer's country |
| 403 | `CONTENT_NOT_PLAYABLE` | Content has no ready video asset (e.g. a course container) |
| 403 | `DEVICE_NOT_REGISTERED` | `deviceId` unknown or belongs to another user |
| 403 | `DEVICE_REVOKED` | Device was revoked |
| 403 | `CONCURRENT_STREAM_LIMIT` | Too many active playback sessions |
| 403 | `PLAYBACK_SESSION_ENDED` | Heartbeat on an ended or revoked session |
| 404 | `NOT_FOUND` | Resource does not exist or is not visible to the caller |
| 409 | `EMAIL_TAKEN` | Registration with an existing email |
| 409 | `DEVICE_LIMIT_REACHED` | Registering more than `MAX_DEVICES` active devices |
| 409 | `PURCHASE_BELONGS_TO_OTHER_ACCOUNT` | Store subscription already linked to another user |
| 409 | `ASSET_NOT_READY` | Publishing playable content whose video is not `ready` |
| 429 | `RATE_LIMITED` | Throttled |
| 503 | `PROVIDER_NOT_CONFIGURED` | Real Apple/Google/AWS integration not configured (fails closed) |

## Shared types

```ts
type Role = "viewer" | "admin";
type AccountStatus = "active" | "suspended" | "deleted";
type ContentKind = "course" | "lesson" | "video";    // course = container of lessons
type AccessTier = "free" | "premium";
type PublicationStatus = "draft" | "published" | "unpublished";
type ProcessingStatus = "awaiting_upload" | "processing" | "ready" | "failed";
type Platform = "android" | "ios" | "web";
type BillingProvider = "apple" | "google" | "razorpay" | "fake";
type DrmSystem = "widevine" | "fairplay" | "playready";
type SubscriptionStatus =
  | "none" | "pending" | "active" | "grace_period" | "billing_retry"
  | "cancelled" | "expired" | "refunded" | "revoked";

interface User {
  id: string; email: string; displayName: string | null;
  role: Role; accountStatus: AccountStatus; createdAt: string;
}

interface Tokens {
  accessToken: string; accessTokenExpiresAt: string;
  refreshToken: string; refreshTokenExpiresAt: string;
}

interface ContentSummary {
  id: string; kind: ContentKind; title: string; description: string;
  accessTier: AccessTier; thumbnailUrl: string | null;
  defaultLanguage: string;            // BCP-47, e.g. "hi", "en"
  ageRating: string | null;           // e.g. "U", "UA 13+"
  durationSeconds: number | null;
}

interface ContentDetail extends ContentSummary {
  parentId: string | null;
  children: ContentSummary[];         // lessons of a course, ordered by position
  subtitles: { language: string; label: string }[];
  playable: boolean;                  // has a ready video asset
}

interface SubscriptionView {
  status: SubscriptionStatus;
  hasAccess: boolean;                 // the only field clients may use to show "premium unlocked" UI
  accessTier: AccessTier | null;
  planCode: string | null;
  provider: BillingProvider | null;
  accessUntil: string | null;
  autoRenewEnabled: boolean;
}

interface Plan {
  code: string;                       // e.g. "premium_monthly"
  name: string;
  billingPeriod: "P1M" | "P1Y";       // ISO-8601 duration
  accessTier: AccessTier;
  storeProducts: { provider: BillingProvider; productId: string }[];
}

interface Device {
  id: string; installationId: string; platform: Platform; name: string;
  lastSeenAt: string; createdAt: string; revokedAt: string | null;
}

interface PlaybackAuthorization {
  playbackSessionId: string;
  contentId: string;
  manifestUrl: string;                // short-lived; never a permanent public URL
  expiresAt: string;                  // playback authorization expiry, extended by heartbeats
  heartbeatIntervalSeconds: number;
  drm: null | {
    system: DrmSystem;
    licenseUrl: string;
    certificateUrl: string | null;    // FairPlay application certificate
    // Headers the player must send on every license request, exactly as given. They carry the
    // short-lived license token; the header names depend on the DRM vendor, so clients never
    // hardcode them. Treat the values as secrets: never log them.
    licenseRequestHeaders: Record<string, string>;
  };
}

interface AdminContent extends ContentSummary {
  publicationStatus: PublicationStatus;
  parentId: string | null;
  position: number;
  regions: string[];                  // ISO-3166 alpha-2, e.g. ["IN"]
  asset: { id: string; processingStatus: ProcessingStatus } | null;
  createdAt: string; updatedAt: string;
}
```

## Endpoints

### Health

| Method | Path | Auth | Response |
|---|---|---|---|
| GET | `/v1/health` | none | `{ "status": "ok", "db": "ok" }` |

### Auth and account

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| POST | `/v1/auth/register` | none | `{ email, password, displayName? }` (password ≥ 10 chars) | `201 { user: User, tokens: Tokens }` |
| POST | `/v1/auth/login` | none | `{ email, password }` | `200 { user, tokens }` |
| POST | `/v1/auth/refresh` | none | `{ refreshToken }` | `200 { tokens }` — rotates the refresh token |
| POST | `/v1/auth/logout` | none | `{ refreshToken }` | `204` — revokes that session; also `204` for an unknown or already-revoked token |
| GET | `/v1/me` | bearer | — | `User` |
| DELETE | `/v1/me` | bearer | — | `204` — soft-deletes the account, revokes sessions, devices and playback |

Refresh-token reuse (presenting an already-rotated token) revokes the whole session family and
returns `401 INVALID_REFRESH_TOKEN`. Access tokens live `ACCESS_TOKEN_TTL_SECONDS` (default 900).

### Catalog (public; no auth needed)

| Method | Path | Query | Response |
|---|---|---|---|
| GET | `/v1/catalog` | `kind?`, `language?`, `page?`, `pageSize?` | `Paginated<ContentSummary>` — published, top-level (no parent) items available in the viewer's country |
| GET | `/v1/content/:id` | — | `ContentDetail` — `404` if unpublished or not available in the viewer's country |

The viewer's country comes from the trusted CDN header named by `TRUSTED_COUNTRY_HEADER` when set,
otherwise `DEFAULT_COUNTRY_CODE` (default `IN`). Clients cannot choose their country.

### Plans and subscriptions

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| GET | `/v1/plans` | none | — | `Plan[]` (store prices come from the store SDK, not this API) |
| GET | `/v1/me/subscription` | bearer | — | `SubscriptionView` (`status: "none"` if never subscribed) |
| POST | `/v1/purchases/verify` | bearer | `{ provider, productId, receipt }` | `200 SubscriptionView` |

`receipt` is the Google Play `purchaseToken`, the Apple `signedTransactionInfo` JWS, or for
`provider: "fake"` any string the fake verifier accepts (see below). The server verifies it with the
provider; the client never asserts its own status.

`provider: "razorpay"` is not used with this endpoint; web purchases go through the Razorpay checkout
endpoints below.

`hasAccess` is `true` only while `accessUntil` is in the future **and** the status is `active`,
`grace_period` or `cancelled` (auto-renew turned off but the paid period has not ended). It is always
`false` for `none`, `pending`, `billing_retry`, `expired`, `refunded` and `revoked`.

### Web checkout (Razorpay)

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| POST | `/v1/checkout/razorpay/subscriptions` | bearer | `{ planCode }` | `201 { razorpaySubscriptionId, keyId, planCode }` |
| POST | `/v1/checkout/razorpay/verify` | bearer | `{ razorpaySubscriptionId, razorpayPaymentId, razorpaySignature }` | `200 SubscriptionView` |

1. The web app asks the API to create a Razorpay subscription for a plan. The API calls the Razorpay
   Subscriptions API with the plan's Razorpay `plan_id` (the plan's `storeProducts` entry with
   `provider: "razorpay"`) and stores a `pending` subscription linked to the user.
2. The browser opens Razorpay Checkout with `keyId` and `razorpaySubscriptionId`.
3. Checkout returns `razorpay_payment_id`, `razorpay_subscription_id` and `razorpay_signature`; the web
   app sends them to `/verify`. The API checks
   `razorpay_signature == hex(HMAC-SHA256(key_secret, razorpay_payment_id + "|" + razorpay_subscription_id))`,
   confirms the subscription belongs to the caller, fetches its current state from Razorpay, and
   applies it. Bad signature → `400 INVALID_PURCHASE`; someone else's subscription →
   `409 PURCHASE_BELONGS_TO_OTHER_ACCOUNT`.
4. Renewals, failures and cancellations arrive by webhook (below); `/verify` is only the fast path.

Without `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` both endpoints return
`503 PROVIDER_NOT_CONFIGURED`. In fake billing mode the web app uses `POST /v1/purchases/verify` with
`provider: "fake"` instead, exactly like the mobile app.

Entitlements are per account, not per billing channel: a subscription bought on the web unlocks the
Android app and vice versa. The Android app must not link to or advertise web checkout (Google Play
policy).

### Devices

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| GET | `/v1/me/devices` | bearer | — | `Device[]` (active only) |
| POST | `/v1/me/devices` | bearer | `{ installationId, platform, name }` | `201 Device` new, `200 Device` if this user already registered that `installationId` (re-activating it if the user had removed it); `403 DEVICE_REVOKED` if an admin blocked it; `409 DEVICE_LIMIT_REACHED` |
| DELETE | `/v1/me/devices/:id` | bearer | — | `204` — removes the device and ends its playback sessions. The device can register again after its owner signs in on it, subject to the device limit. |

`installationId` is a UUID the app generates once and keeps in secure storage. The web app generates
one per browser and keeps it in a long-lived httpOnly cookie; each browser counts as one device
(`platform: "web"`).

### Playback

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| POST | `/v1/playback/sessions` | bearer | `{ contentId, deviceId, supportedDrm? }` | `201 PlaybackAuthorization` |
| POST | `/v1/playback/sessions/:id/heartbeat` | bearer | `{ positionSeconds? }` | `200 { expiresAt }` |
| DELETE | `/v1/playback/sessions/:id` | bearer | — | `204` |

`supportedDrm` is an optional `DrmSystem[]` the client can actually play (browsers report what their
EME implementation supports; Android sends `["widevine"]`). The media provider picks the DRM system
from it; if none of them is usable for premium content in production, the request fails with
`403 CONTENT_NOT_PLAYABLE`.

Checks for a new session, in order (first failure wins):
1. Account active → else `403 ACCOUNT_INACTIVE`.
2. Content exists, is published and is available in the viewer's country → else `404 NOT_FOUND` /
   `403 REGION_NOT_ALLOWED`.
3. Content has a `ready` video asset → else `403 CONTENT_NOT_PLAYABLE`.
4. Premium content needs an active entitlement → else `403 ENTITLEMENT_REQUIRED`.
5. Device belongs to the user and is not revoked → else `403 DEVICE_NOT_REGISTERED` / `DEVICE_REVOKED`.
6. Active sessions (not ended/revoked, heartbeat within the stale window) < `MAX_CONCURRENT_STREAMS`
   (default 2) → else `403 CONCURRENT_STREAM_LIMIT`.

A heartbeat that arrives after the session went stale (no heartbeat within 3× the interval, for
example while the app was in the background) returns `403 PLAYBACK_SESSION_ENDED`; the client creates
a new session, which re-applies the concurrent-stream limit.

A heartbeat re-runs checks 1, 2, 4 and 5, so unpublishing content or removing a region also ends
active sessions. If any fails, the session is revoked and the heartbeat returns that error code. A heartbeat on an ended or revoked session returns `403 PLAYBACK_SESSION_ENDED`.
Clients send heartbeats every `heartbeatIntervalSeconds` and stop the player on any 403.

### Webhooks (server-to-server)

| Method | Path | Notes |
|---|---|---|
| POST | `/v1/webhooks/apple` | App Store Server Notifications v2. Stub returns `503 PROVIDER_NOT_CONFIGURED` until configured. |
| POST | `/v1/webhooks/google` | Play Real-time Developer Notifications (Pub/Sub push). Stub returns `503 PROVIDER_NOT_CONFIGURED` until configured. |
| POST | `/v1/webhooks/razorpay` | Razorpay webhooks. Verify `X-Razorpay-Signature` = hex HMAC-SHA256 of the raw body with `RAZORPAY_WEBHOOK_SECRET`; `eventId` comes from the `X-Razorpay-Event-Id` header. Returns `503 PROVIDER_NOT_CONFIGURED` when Razorpay is not configured. |
| POST | `/v1/webhooks/fake` | Only mounted when `BILLING_MODE=fake` and not production. |

Razorpay event mapping (subscription entity in the payload):

| Razorpay event | Subscription status | Notes |
|---|---|---|
| `subscription.authenticated` | `pending` | Mandate set up, no successful charge yet |
| `subscription.activated`, `subscription.charged` | `active` | `current_period_end` = subscription `current_end`; record the payment in `billing_transactions` |
| `subscription.pending` | `billing_retry` | Charge failed, Razorpay is retrying; no access |
| `subscription.halted` | `expired` | Retries exhausted |
| `subscription.cancelled` | `cancelled` | Access continues until `current_end` |
| `subscription.completed` | `expired` | All billing cycles done |
| `refund.processed` | `refunded` | When it refunds the latest charge of a subscription |

All handlers: verify authenticity first, store the event in `provider_events` keyed by
`(provider, eventId)`, return `200 { "duplicate": true }` for a repeat without re-applying it, and
apply state changes inside one database transaction.

### Admin (`role: "admin"` required; others get `403 FORBIDDEN`)

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/v1/admin/content` | query `kind?`, `status?`, `parentId?`, `page?`, `pageSize?` | `Paginated<AdminContent>` — without `parentId`: top-level items only (courses and standalone videos), newest `updatedAt` first; with `parentId`: that item's children by `position` |
| POST | `/v1/admin/content` | `{ kind, title, description, accessTier, defaultLanguage, ageRating?, thumbnailUrl?, parentId?, position?, regions }` | `201 AdminContent` (status `draft`) |
| GET | `/v1/admin/content/:id` | — | `AdminContent & { children: AdminContent[] }` |
| PATCH | `/v1/admin/content/:id` | any subset of `{ title, description, accessTier, defaultLanguage, ageRating, thumbnailUrl, position, regions }`; `null` clears `ageRating` / `thumbnailUrl` | `AdminContent`. `kind` and `parentId` cannot change (sending them → `400 VALIDATION_FAILED`). |
| POST | `/v1/admin/content/:id/upload-session` | — | `201 { videoAssetId, uploadUrl, method: "PUT", headers: Record<string,string>, expiresAt }`; `400 VALIDATION_FAILED` for a course (courses have no video) |
| POST | `/v1/admin/content/:id/publish` | — | `AdminContent`; `409 ASSET_NOT_READY` for a lesson/video without a ready asset (courses publish without one) |
| POST | `/v1/admin/content/:id/unpublish` | — | `AdminContent` |
| GET | `/v1/admin/users` | query `email?` (case-insensitive substring; omitted lists everyone, newest first), `page?`, `pageSize?` | `Paginated<{ user: User, subscription: SubscriptionView }>` |
| GET | `/v1/admin/users/:id` | — | `{ user, subscription: SubscriptionView, devices: Device[] (incl. revoked), activePlaybackSessions: { id, contentId, contentTitle, deviceId, startedAt, lastHeartbeatAt }[] }` |
| POST | `/v1/admin/users/:id/sessions/revoke` | — | `204` — revokes all login sessions; their access tokens stop working immediately |
| POST | `/v1/admin/devices/:id/revoke` | — | `204` — blocks the device permanently; registering it again returns `403 DEVICE_REVOKED` |
| POST | `/v1/admin/playback-sessions/:id/revoke` | — | `204` |

Every admin write is recorded in `audit_logs` (actor, action, target, timestamp).

Content rules:
- `position` is a 0-based integer among siblings. When omitted on create, the item goes last. PATCH
  can change it; siblings are not renumbered, and ties sort by `createdAt`.
- A lesson is visible to viewers (catalog, content detail, playback) only while both the lesson and
  its course are published. A lesson can be published while its course is still a draft, so a course
  can be prepared and released in one step.
- Each lesson or video has one video asset. Uploading again replaces it: the new asset starts in
  `processing`, and playback returns `403 CONTENT_NOT_PLAYABLE` until it is `ready`. Unpublish first if
  that gap is not acceptable.
- The upload `headers` must be sent exactly as returned (they may be empty). A successful upload `PUT`
  returns `204`.

## Fake providers (development and tests only)

Enabled by `MEDIA_PROVIDER=fake` and `BILLING_MODE=fake`. The API refuses to start with either fake
mode when `NODE_ENV=production`.

**Fake media**
- `uploadUrl` = `{PUBLIC_API_BASE_URL}/v1/dev/media/uploads/{providerAssetId}?exp=<unix>&sig=<hex>`.
  A `PUT` with any body marks the asset `ready` (simulating upload + transcoding finished).
- `manifestUrl` = `{PUBLIC_API_BASE_URL}/v1/dev/media/{providerAssetId}/manifest.m3u8?sid=<playbackSessionId>&exp=<unix>&sig=<hex>`.
  A valid, unexpired signature gets `302` to `FAKE_SAMPLE_MANIFEST_URL` (an unprotected public test
  HLS stream); a bad or expired one gets `401 INVALID_SIGNATURE`.
- `sig` = hex HMAC-SHA256 with `FAKE_MEDIA_SIGNING_SECRET`; `drm` is always `null`.

**Fake billing**
- `POST /v1/purchases/verify` with `provider: "fake"`: `receipt` is treated as the subscription's
  original transaction id; `productId` must be a fake store product from `/v1/plans`. It creates or
  refreshes an `active` subscription for one billing period from now.
- `POST /v1/webhooks/fake` with header `X-Fake-Signature: <hex HMAC-SHA256 of the raw body with FAKE_WEBHOOK_SECRET>`
  and body `{ eventId, type, originalTransactionId, expiresAt? }`, where `type` is one of
  `RENEWED | CANCELLED | EXPIRED | REFUNDED | REVOKED | GRACE_PERIOD | BILLING_RETRY`.
  Bad signature → `401 INVALID_SIGNATURE`.

## Environment variables (API)

| Name | Default (dev) | Notes |
|---|---|---|
| `NODE_ENV` | `development` | `production` disables fake providers and `/v1/dev/*` |
| `PORT` | `3000` | |
| `DATABASE_URL` | `postgres://streaming:streaming@localhost:5432/streaming_dev` | tests use `streaming_test` |
| `JWT_ACCESS_SECRET` | — (required, ≥ 32 chars) | |
| `ACCESS_TOKEN_TTL_SECONDS` | `900` | |
| `REFRESH_TOKEN_TTL_DAYS` | `30` | |
| `CORS_ORIGINS` | `http://localhost:3001,http://localhost:3002` | comma-separated (admin web, viewer web). The fake media routes must send CORS headers for these origins because the web player fetches them directly. |
| `DEFAULT_COUNTRY_CODE` | `IN` | |
| `TRUSTED_COUNTRY_HEADER` | unset | e.g. `cloudfront-viewer-country` behind the CDN |
| `MAX_DEVICES` | `3` | |
| `MAX_CONCURRENT_STREAMS` | `2` | |
| `PLAYBACK_AUTH_TTL_SECONDS` | `300` | |
| `PLAYBACK_HEARTBEAT_INTERVAL_SECONDS` | `30` | sessions are stale after 3× this |
| `PUBLIC_API_BASE_URL` | `http://localhost:3000` | used to build fake media URLs |
| `MEDIA_PROVIDER` | `fake` | `fake` \| `aws` (aws is a fail-closed stub) |
| `FAKE_MEDIA_SIGNING_SECRET` | — | required when `MEDIA_PROVIDER=fake` |
| `FAKE_SAMPLE_MANIFEST_URL` | a public test HLS stream | |
| `BILLING_MODE` | `fake` | `fake` \| `live` |
| `FAKE_WEBHOOK_SECRET` | — | required when `BILLING_MODE=fake` |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` | unset | web checkout; unset means `503 PROVIDER_NOT_CONFIGURED` |
| `RAZORPAY_PLAN_ID_MONTHLY` / `RAZORPAY_PLAN_ID_YEARLY` | unset | Razorpay `plan_id`s the seed maps to `premium_monthly` / `premium_yearly` |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | — | used by the seed script only |

## Client configuration

- **Viewer web** (`apps/web`, port `3002`): `API_BASE_URL` (default `http://localhost:3000`),
  `SESSION_COOKIE_SECRET`, `NEXT_PUBLIC_FAKE_BILLING`, `REQUIRE_DRM`, `WEB_MAX_VIDEO_HEIGHT` (default
  `720`). Tokens live only in httpOnly cookies set by Next route handlers; the browser talks to the API
  only through the web app's own server, except for media/DRM URLs and Razorpay Checkout.

- **Admin web** (`apps/admin-web`, port `3001`): `API_BASE_URL` (default `http://localhost:3000`),
  `SESSION_COOKIE_SECRET`. Tokens live only in httpOnly cookies set by Next route handlers.
- **Mobile** (`apps/mobile`): `--dart-define=API_BASE_URL=...` (Android emulator:
  `http://10.0.2.2:3000`, iOS simulator: `http://localhost:3000`), `FAKE_BILLING=true` to show the
  development "simulate purchase" button, `REQUIRE_DRM=true` to refuse playback authorizations without
  DRM (use in release builds once the DRM provider is live). Tokens and `installationId` live in
  platform secure storage.
- On an Android emulator or a USB-connected phone, run `adb reverse tcp:3000 tcp:3000` and use
  `API_BASE_URL=http://localhost:3000`; fake media URLs built from the default `PUBLIC_API_BASE_URL`
  then work too. Without `adb reverse`, set both to the host's LAN IP.
