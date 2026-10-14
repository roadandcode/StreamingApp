# StreamingApp: product and technical plan

StreamingApp is an India-first subscription video-streaming app. It launches on **Android and the web**
together; an iOS app follows if the launch proves profitable. Subscribers pay to watch our own
original videos and courses; premium content is playable only by paying subscribers and is protected
with DRM (Widevine on Android and in browsers, FairPlay on iOS and Safari) and server-side playback
authorization.

This document is the complete plan: what we are building, how the pieces fit together, how access is
protected, what it is likely to cost, and the order in which to build it.

> **About the numbers.** Every price, cost, duration and traffic figure in this document is a
> planning **estimate**, not a vendor quote or a promise. Re-check provider pricing, store rules and
> legal requirements before relying on any of them.

## Contents

- [Decisions so far](#decisions-so-far)
- [Repository status](#repository-status)
- [1. The complete picture](#1-the-complete-picture)
- [2. Technology stack](#2-technology-stack)
- [3. System architecture](#3-system-architecture)
- [4. Video pipeline: hosting and delivery](#4-video-pipeline-hosting-and-delivery)
- [5. Subscription system](#5-subscription-system)
- [6. Security: making unauthorized viewing difficult](#6-security-making-unauthorized-viewing-difficult)
- [7. Playback authorization flow](#7-playback-authorization-flow)
- [8. Database](#8-database)
- [9. APIs](#9-apis)
- [10. Admin dashboard and publishing workflow](#10-admin-dashboard-and-publishing-workflow)
- [11. Mobile app screens and experience](#11-mobile-app-screens-and-experience)
- [12. India first, then worldwide](#12-india-first-then-worldwide)
- [13. Legal, privacy, tax and app-store rules](#13-legal-privacy-tax-and-app-store-rules)
- [14. Cost model](#14-cost-model)
- [15. Provider decision](#15-provider-decision)
- [16. DRM proof-of-concept requirements](#16-drm-proof-of-concept-requirements)
- [17. Itemized budget (estimates)](#17-itemized-budget-estimates)
- [18. App-store and developer account fees](#18-app-store-and-developer-account-fees)
- [19. Roadmap](#19-roadmap)
- [20. Launch plan (week by week)](#20-launch-plan-week-by-week)
- [21. Testing and deployment checklists](#21-testing-and-deployment-checklists)
- [22. India launch checklist](#22-india-launch-checklist)
- [23. Post-launch metrics](#23-post-launch-metrics)
- [24. What to do in the first seven days](#24-what-to-do-in-the-first-seven-days)
- [25. Final recommendation](#25-final-recommendation)
- [Official references](#official-references)

## Decisions so far

| Area | Decision |
|---|---|
| Content | Our own original videos and courses. No licensed third-party catalog and no live streaming in the first release. |
| Protection | Strong DRM and anti-piracy: Widevine on Android and in Chrome, Edge and Firefox; FairPlay for Safari (needs Apple's FairPlay credentials) and later the iOS app; plus server-side entitlement checks, short-lived playback authorizations, device and concurrent-stream limits. |
| Team | Solo developer. Buy the difficult media-security components; build the business logic in-house. |
| Budget | Not fixed yet. Compare a lean launch with a DRM-first launch (see [§15](#15-provider-decision) and [§17](#17-itemized-budget-estimates)). |
| Market | India first (INR pricing, Indian payment methods through the stores), then worldwide through configuration rather than a rebuild. |
| Platform rollout | **Android and web at launch** for the widest early audience; iOS follows if the launch is profitable. The platform-neutral backend serves both, and the Flutter codebase keeps iOS cheap to add. See [§19](#platform-rollout-and-timeline). |
| Mobile app | Flutter, shipping on Android with native Media3/ExoPlayer playback for Widevine. The same codebase targets iOS later, with AVPlayer for FairPlay. |
| Web | Next.js viewer website: server-rendered public catalog and course pages that search engines can index, sign-in, Razorpay subscriptions, and a Shaka Player web player with browser DRM. Video on the web is capped at 720p by default, and a viewer watermark is shown, because browsers cannot block screen capture. |
| Backend | NestJS + TypeScript as a modular monolith, PostgreSQL as the source of truth. |
| Admin | Next.js admin dashboard (content, uploads, publishing, user support). |
| Media pipeline | Option B, DRM-first: private S3 → AWS Elemental MediaConvert → CloudFront, plus a specialist multi-DRM vendor. The vendor is **not chosen yet**; the backend talks to it through a provider interface with a fake implementation for development. |
| Billing | At launch: Google Play Billing + Play Developer API and Real-time Developer Notifications (RTDN) on Android, and Razorpay subscriptions on the web (no store commission on web sales). Entitlements are per account, so a subscription from either channel unlocks both; the Android app must not link to web checkout (Google Play policy). With the iOS app: Apple StoreKit + App Store Server API and Server Notifications. |
| First milestone | A proof of concept on Android and the web: a paying user plays a Widevine-encrypted video on a real Android phone and in desktop Chrome, and an unauthorized user cannot obtain a new playback authorization. |

## Repository status

The repository is a monorepo:

| Path | What it is |
|---|---|
| `services/api` | NestJS + PostgreSQL backend: auth, catalog, subscriptions, entitlements, playback authorization, devices, webhooks, admin APIs |
| `apps/admin-web` | Next.js admin dashboard (port 3001) |
| `apps/mobile` | Flutter app (Android at launch; iOS later from the same codebase) |
| `packages/api-contracts` | OpenAPI JSON emitted by the API, plus generated TypeScript types |
| `docs/` | This plan, architecture, API contract, security and operations notes |
| `infrastructure/` | Local database setup and deployment notes |

Current state:

- The monorepo foundation and the v1 API contract are in place:
  [`architecture/api-contract.md`](architecture/api-contract.md) is the authoritative contract for
  every client.
- The API, admin dashboard and mobile app are being built against that contract.
- **Real AWS media, DRM and App Store / Google Play integrations are still pending.** They sit behind
  provider interfaces whose real implementations are fail-closed stubs: they return
  `503 PROVIDER_NOT_CONFIGURED` and never grant access. Development and tests use fake media and fake
  billing providers, which the API refuses to start with in production.

Related documents:

- [Architecture overview](architecture/overview.md): diagrams of the system, modules, playback flow,
  subscription states, publishing workflow and data model.
- [Threat model](security/threat-model.md): assets, trust boundaries, attacks and the controls that
  answer them.
- [Local development](operations/local-dev.md): running the API, admin dashboard and mobile app with
  the fake providers.
- [Infrastructure notes](../infrastructure/README.md): environments, secrets, database and CDN.

## 1. The complete picture

A streaming business is more than a good-looking app. The backend must control who can watch, which
content they can access, and when that access ends. Design the subscription, video-delivery and
security systems together from day one.

The product has four parts:

1. **Android and iOS apps** (the customer-facing product): sign-up, login, browsing, the video
   player, search, watch history, favorites, subscription plans and account management.
2. **Video infrastructure** (content delivery): upload original videos, transcode them into multiple
   qualities, encrypt and package them for streaming, store them privately and deliver them through a
   CDN.
3. **Backend and subscription engine** (the authority that decides access): validate payments,
   maintain entitlements, authorize playback, enforce device limits and revoke access when necessary.
4. **Admin dashboard** (the business control center): upload and organize content, schedule
   releases, look after subscribers, monitor streaming quality and review business analytics.

For the first release, use managed services for video processing, delivery and DRM rather than
building that infrastructure ourselves, and build our own app, backend, subscription rules and admin
experience around them. That gives a faster launch while keeping full control of the business logic.

## 2. Technology stack

| Layer | Choice | Notes |
|---|---|---|
| Mobile client | Flutter (one codebase for Android and iOS) | Playback goes through platform-native players: Media3/ExoPlayer on Android and AVPlayer on iOS. Use a DRM-capable player integration, not a generic player chosen for convenience. React Native was the main alternative considered. |
| Backend API | NestJS + TypeScript | One deployable modular application with separate modules for auth, users, catalog, media, billing, entitlements, playback, devices, webhooks and admin. |
| Database | Managed PostgreSQL | Migrations, automated backups, unique constraints and a least-privilege database account. |
| Media pipeline | Private S3, AWS Elemental MediaConvert, CloudFront, a specialist multi-DRM service | The DRM vendor must support Widevine and FairPlay for our packaging formats and target devices. |
| Subscriptions | StoreKit / App Store Server API, Google Play Billing / Play Developer API, server notifications from both | Keep web checkout (Razorpay) separate until the app-store compliance path is clear. |
| Admin panel | Next.js | A private website for managing videos, publishing, support and analytics. |

**Flutter is the application framework, not the video-security solution.** The actual player must
support the required streaming protocols and DRM on each platform, which is why playback is native.

Supporting services:

| Requirement | Choice |
|---|---|
| API hosting | Managed container or application hosting |
| Login | Our own backend authentication with rotating refresh tokens (a managed identity provider remains an option) |
| Cache and rate limiting | Redis-compatible managed service, when needed |
| Error monitoring | Sentry or an equivalent service |
| Product analytics | PostHog or an equivalent service |
| Push notifications | Firebase Cloud Messaging and Apple Push Notification service |
| Automated deployments | GitHub Actions |
| Secrets | Cloud secret manager; never embed private keys in the mobile app |

## 3. System architecture

The key principle: **the mobile app never decides whether a customer may watch premium content.** It
asks the backend, and the backend checks the verified subscription and authorizes playback.

Video is delivered directly from the CDN to the device rather than through the application server.
That keeps video traffic from overwhelming the backend and avoids paying the application server to
relay large media files.

```text
Android / iOS apps  ──►  API (auth, rate limits, authorization)
                           │            │
                      PostgreSQL     Billing providers (Apple, Google, web later)
                           │
                  Playback authorization (entitlement, device rules, short-lived credentials)
                           │
              ┌────────────┴────────────┐
        Video CDN (encrypted        DRM license service
        segments)                   (authorized decryption)
```

Detailed Mermaid diagrams are in the [architecture overview](architecture/overview.md).

### Backend modules

Start as a **modular monolith**: one backend application with clear modules. Seven independent
microservices are not needed on day one; split modules out later only if traffic, team size or
operations justify it.

1. **Identity:** registration, login, logout, password recovery, account deletion, session management.
2. **Catalog:** courses, lessons and videos, languages, thumbnails, release dates, availability by
   country.
3. **Subscriptions and entitlements:** current access rights, renewal state, expiry, cancellation,
   grace periods, refunds and billing reconciliation.
4. **Playback:** checks entitlement and issues short-lived playback authorization.
5. **Devices:** tracks registered devices and enforces concurrency limits.
6. **Webhooks:** receives payment and subscription events from Apple, Google and, later, the web
   payment provider.
7. **Admin:** content uploads, publishing, user support and operational controls.

Keep the mobile app, admin UI and backend separate in the repository. API schemas and generated client
types can be shared without sharing any business secrets (see [Repository status](#repository-status)).

## 4. Video pipeline: hosting and delivery

A master video is not uploaded and sent unchanged to every subscriber. It needs multiple quality
levels, streaming formats, access controls and DRM encryption.

1. **Upload the master video.** The admin uploads a high-quality original through a private upload
   workflow (a short-lived, single-purpose upload URL).
2. **Transcode.** Generate 360p, 480p, 720p, 1080p and other appropriate renditions.
3. **Package.** Produce HLS and/or DASH manifests and media segments for adaptive playback.
4. **Encrypt and protect.** Apply DRM, keep the origin private, and restrict playback authorization.
5. **Deliver through a CDN.** Distribute media efficiently to viewers in India and, later, other
   countries.
6. **Play on the device.** The player adapts quality to bandwidth and obtains a DRM license.

**Why HLS and adaptive bitrate streaming?** HLS splits video into short segments and publishes a
playlist of the available renditions, so the player can switch quality as the network changes. DASH
offers a similar adaptive model and is common in DRM workflows. A viewer on a slow mobile connection
might get 480p while a viewer on fast Wi-Fi gets 1080p, and nobody has to download the whole video
before watching.

**Never publish an asset just because the upload finished.** Confirm that processing succeeded and
that the required security settings are in place first.

## 5. Subscription system

This is the heart of the product: **separate payment processing from access authorization.** A
payment provider tells us whether a transaction or subscription is valid. Our backend uses that
verified information to decide what the user can watch.

### Lifecycle

1. The user chooses a plan (monthly, yearly or another configured plan).
2. The user pays through an approved billing channel (Apple, Google Play or, later, eligible web
   checkout).
3. The backend verifies the purchase server-side with the store or payment provider.
4. The backend updates the user's normalized entitlement in PostgreSQL.
5. Playback is authorized only for content covered by the current entitlement.

### Expected behavior by event

| Event | Expected system behavior |
|---|---|
| First successful payment | Activate the entitlement after server-side verification. |
| App is reinstalled | Restore purchases and recover access for the same account. |
| Subscription auto-renews | Update expiry and access from verified billing information. |
| User cancels renewal | Keep access until the paid period ends, unless the provider reports a different state. |
| Payment fails | Apply the grace-period or billing-retry policy, then expire. |
| Refund or chargeback | Record the refund, reconcile the transaction and revoke access when warranted. |
| Subscription expires | Stop issuing new playback authorizations; active sessions end at their next heartbeat. |
| User changes devices | Apply the registered-device and concurrent-playback rules. |
| Store notification is delayed | Re-check status with the provider instead of trusting stale client state. |

Do not rely only on webhooks: notifications can be delayed, duplicated or delivered out of order.
Verify each notification, process it idempotently, and periodically reconcile our records against the
billing provider.

### Billing channels

- **Apple: StoreKit and the App Store Server API.** In-app subscriptions, server-side transaction
  verification, subscription-status checks and App Store Server Notifications. Apple's reader-app
  rules may allow access to video subscriptions bought elsewhere, subject to eligibility and storefront
  rules. See [Apple In-App Purchase](https://developer.apple.com/in-app-purchase/) and the
  [App Store Server API](https://developer.apple.com/documentation/appstoreserverapi).
- **Android: Google Play Billing.** Subscription purchases, purchase-token verification, Real-time
  Developer Notifications, acknowledgement and lifecycle handling. Google's payments policy generally
  requires Play Billing for digital subscriptions, with specific exceptions and alternative-billing
  programs. See [Google Play Billing](https://developer.android.com/google/play/billing).
- **Website: Razorpay or another suitable gateway (later).** Useful for eligible web purchases and
  local payment methods, giving a direct channel outside the stores. Do not assume users can be sent to
  external checkout from any iOS or Android screen; follow the rules for each storefront, app category
  and billing program.

**India note:** Google runs alternative-billing programs that eligible developers in India can use,
with enrollment, reporting, fee and user-experience requirements. Apple has separate rules and
entitlements. Check the current requirements before designing checkout screens.

### One unified entitlement model

Apple, Google and web subscribers are not three kinds of user. Each provider's verified status is
normalized into one internal model, for example:

| Field | Example |
|---|---|
| Account | User 1042 |
| Billing provider | Google Play |
| Plan | Premium Monthly (`premium_monthly`) |
| Entitlement | Active |
| Access until | The verified expiry timestamp from the provider |
| Auto-renew | Enabled |

The values are illustrative; the system stores the actual verified values. Where Apple's rules allow
cross-channel access, the entitlement service grants the same access regardless of the original
billing channel.

### Subscription states

A subscription can be **cancelled but still grant access** until its paid period ends, so `cancelled`
must never be treated as `expired`. The state model is:

| State | Meaning | Grants access? |
|---|---|---|
| `pending` | Purchase started but not yet verified or completed | No |
| `active` | Paid and current | Yes |
| `grace_period` | Renewal payment failed; the store is still granting access while it retries | Yes, until the grace period ends |
| `billing_retry` | Renewal payment failed and the store is retrying without granting access | No |
| `cancelled` | Auto-renew turned off; the paid period has not ended yet | Yes, until `accessUntil` |
| `expired` | The paid period ended without renewal | No |
| `refunded` | Refunded or charged back | No |
| `revoked` | Revoked by the store or by us (for example fraud) | No |

The API's `SubscriptionView.hasAccess` is the only field clients use to show premium UI, and the
server computes it. Map each provider's documented lifecycle onto these states explicitly, write the
mapping down and test it. The state diagram is in the
[architecture overview](architecture/overview.md#subscription-states).

## 6. Security: making unauthorized viewing difficult

**No streaming system can guarantee that nobody will ever copy a video.** A determined person can
point a camera at a screen, compromise a device, or redistribute content after watching it
legitimately. The goal is to prevent unauthorized access, limit extraction, deter redistribution and
make abuse detectable.

### The five layers of protection

1. **Backend authorization.** Every playback request checks identity, account status, entitlement,
   content availability and device rules. Never trust a flag such as `isPremium = true` sent by the app.
2. **Short-lived playback credentials.** Issue time-limited signed URLs, cookies or tokens after
   authorization. No permanent public video links. Protect the manifest, every media segment and
   related assets, not only the first URL. CloudFront supports signed URLs and cookies for private
   content.
3. **DRM encryption.** Google Widevine on Android and Apple FairPlay Streaming on iOS. Other devices
   and browsers get a compatible DRM system when we expand to them.
4. **Device and playback controls.** Limit registered devices and simultaneous streams. Detect
   excessive concurrent sessions, token sharing, suspicious IP changes and abnormal playback patterns.
   Treat platform integrity signals as risk indicators, not as the only authorization mechanism.
5. **Watermarking and monitoring.** Consider visible account/session watermarks or forensic
   watermarking for high-value content. Log suspicious behavior, investigate repeated token abuse and
   revoke compromised sessions. Watermarking deters and attributes leaks; it does not prevent every
   recording.

### Attacks and defenses

| Attack | Defense |
|---|---|
| Change a local app flag to unlock premium | Entitlements are verified on the backend. |
| Extract a permanent video URL | No permanent public playback URL; only signed, expiring access. |
| Replay a stolen playback credential | Short expiry, binding to the playback session where supported, and abuse detection. |
| Forge a purchase response | Verify the transaction server-side with the store or trusted provider. |
| Use another person's account | Device limits, concurrent-stream limits and anomaly detection. |
| Hammer the playback API | Rate limits, quotas, monitoring and abuse controls. |
| Download raw unencrypted source files | Originals stay in private storage; master files are never delivered to customers. |
| Record a legitimately playing video | DRM, secure device capabilities, OS capture restrictions where available, watermarking. Residual risk remains. |
| Steal a server secret from the app binary | Signing and DRM secrets live only in trusted server-side systems. |

**A signed URL is not DRM.** A signed URL controls access to a resource. DRM encrypts the media and
controls how a compatible player obtains permission to decrypt it. Premium content uses both.

### Web-specific limits

Browsers are the weakest playback environment. On most desktops, browser Widevine runs in software,
and no browser can stop screen recording. The website therefore:

- caps video at 720p by default (enforced in packaging and DRM license policy, not only in the player);
- shows a subtle moving watermark with the viewer's account email;
- counts each browser as a device for the device limit, and uses the same heartbeats and concurrent
  stream limit as the app;
- keeps login tokens in httpOnly cookies on the web server, never in browser storage.

The full threat model, with the concrete controls in this codebase, is in
[`security/threat-model.md`](security/threat-model.md).

### Anti-piracy implementation checklist

No single control is enough: DRM alone is not enough, and a signed URL alone is not enough.

**A. Protect the source and media pipeline**

- [ ] Keep original videos in private storage.
- [ ] Allow uploads only from authenticated, authorized administrators.
- [ ] Use short-lived upload credentials scoped to the intended upload.
- [ ] Allow only approved media-processing jobs to publish assets.
- [ ] Keep encryption keys and signing secrets in a managed secret/key system.
- [ ] Use separate permissions for uploading, transcoding, publishing and playback.
- [ ] Configure the CDN so users cannot bypass it and reach the origin directly.
- [ ] Make sure the source video cannot be downloaded from the admin interface.

**B. Enforce playback authorization**

- [ ] Check the subscription on every new playback-session request.
- [ ] Check the content's region and access tier.
- [ ] Issue credentials with short, appropriate lifetimes.
- [ ] Protect manifests and media segments, not just the first URL.
- [ ] Use DRM license policies appropriate to the content's risk level.
- [ ] Record playback-session state and provide a revocation mechanism.
- [ ] Revalidate long-running sessions (heartbeats).
- [ ] Rate-limit authorization and license-related requests.
- [ ] Detect repeated failures, abnormal concurrent streams and credential sharing.

**C. Harden Android and iOS**

- [ ] Store tokens in platform secure storage (Android Keystore-backed storage, iOS Keychain).
- [ ] Never log authorization headers or signed URLs.
- [ ] Use platform-integrity signals to identify suspicious clients.
- [ ] Restrict screen capture where the OS and DRM allow it (for example `FLAG_SECURE` on Android).
- [ ] Test rooted, jailbroken, modified and older devices according to the risk policy.
- [ ] Do not rely on obfuscation, certificate pinning or a device-integrity verdict as the only defense.

**D. Deterrence and response**

- [ ] Consider forensic watermarking if the content's value justifies the cost.
- [ ] Have a support process for suspected account sharing.
- [ ] Log privileged administrator actions.
- [ ] Document how to revoke compromised sessions and rotate secrets.
- [ ] Maintain a tested incident-response procedure.
- [ ] Define what evidence is retained and for how long, within privacy obligations.

**Acceptance criterion:** if someone changes a client-side flag, replays an expired playback
credential, or submits a forged purchase, they must not obtain a new playback authorization. That is a
far more useful target than claiming piracy is impossible.

## 7. Playback authorization flow

When a subscriber taps a premium lesson:

1. The app sends an authenticated request:

   ```http
   POST /v1/playback/sessions
   Authorization: Bearer <accessToken>
   Content-Type: application/json

   { "contentId": "<content uuid>", "deviceId": "<registered device uuid>" }
   ```

2. The backend runs its checks in a fixed order, and the first failure wins: account active; content
   exists, is published and is available in the viewer's country; content has a ready video asset;
   premium content has an active entitlement; the device belongs to the user and is not revoked; the
   concurrent-stream limit is not exceeded. The exact order and error codes are defined in the
   [API contract](architecture/api-contract.md#playback).
3. If every check passes, the backend records a playback session, asks the media provider for
   short-lived playback credentials and returns a `PlaybackAuthorization`: the session id, a
   short-lived manifest URL, an expiry, a heartbeat interval and, in production, the DRM configuration
   (Widevine or FairPlay license URL, FairPlay certificate URL, short-lived license token). It never
   returns reusable signing keys or long-lived DRM secrets.
4. The native player fetches the manifest and segments with those credentials and requests a DRM
   license.
5. While playing, the app sends a heartbeat every `heartbeatIntervalSeconds`. Each heartbeat re-checks
   the account, the entitlement and the device. If any fails, the server revokes the session and the
   app stops the player.

### Four different expiries

These are separate security controls and must not be confused:

| Control | What it limits | Default in this design |
|---|---|---|
| Login session | How long an access token is valid (refresh tokens rotate) | Access token 15 minutes, refresh token 30 days |
| Playback authorization | How long a playback session stays valid without a heartbeat | 300 seconds, extended by heartbeats every 30 seconds |
| DRM license | How long the player may decrypt | Set by the DRM vendor's license policy; keep it short and non-persistent |
| Subscription entitlement | Whether the user is entitled at all | The verified `accessUntil` from the store |

### If the subscription lapses mid-playback

Decision: playback is revalidated during long sessions. The next heartbeat after the entitlement
lapses fails, the server revokes the playback session, and the client stops the player on any `403`.
A DRM license that was already issued is controlled by the DRM vendor's policy and the client, so the
backend alone cannot guarantee it stops working instantly; this is why license durations stay short.

### If the app is modified

The app holds no server secrets and makes no entitlement decisions. A modified client still has to
pass the backend checks and the DRM license service, so it cannot grant itself access.

## 8. Database

PostgreSQL is the source of truth for business data. The mobile device is never the authoritative
store of subscription status: a local cache can improve the interface but cannot grant premium access.

| Table | Purpose and key fields |
|---|---|
| `users` | `id`, `email`, `role`, `account_status`, `email_verified_at`, `created_at`, `deleted_at` |
| `user_sessions` | Refresh-token sessions: `user_id`, `token_hash`, `family_id`, `expires_at`, `revoked_at` |
| `devices` | `user_id`, `installation_id`, `platform`, `name`, `last_seen_at`, `revoked_at`, `risk_status` |
| `content` | Courses, lessons and videos: `kind`, `parent_id`, `position`, `title`, `description`, `access_tier`, `publication_status`, `age_rating`, `default_language` |
| `video_assets` | `content_id`, `provider_asset_id`, `processing_status`, `drm_profile`, `published_at` |
| `subtitles` | `content_id`, `language`, `label`, storage reference |
| `content_regions` | `content_id`, `country_code`, `available_from`, `available_until` |
| `plans` | `code` (for example `premium_monthly`), `name`, `billing_period`, `access_tier`, `status` |
| `store_products` | `plan_id`, `provider`, `product_id`, `storefront` |
| `subscriptions` | `user_id`, `provider`, `provider_subscription_id` / original transaction id, `status`, `current_period_end`, `cancel_at_period_end`, `last_verified_at` |
| `billing_transactions` | `provider_transaction_id`, `original_transaction_id`, `currency`, `gross_amount`, `tax_amount`, `refund_status` |
| `entitlements` | `user_id`, `plan_id`, `access_tier`, `valid_from`, `valid_until`, `source_subscription_id`, `revoked_at` |
| `playback_sessions` | `user_id`, `device_id`, `content_id`, `started_at`, `last_heartbeat_at`, `ended_at`, `revoked_at` |
| `provider_events` | Webhook deduplication and history: `provider`, `event_id`, `payload_hash`, `received_at`, `processed_at`, `processing_status` |
| `drm_license_audit` | License requests per playback session, for abuse investigation |
| `audit_logs` | `actor_id`, `action`, `target`, `created_at` for admin actions and security events |

Store the provider references needed to reconcile billing; do not keep unnecessary payment details or
raw credentials. The ER diagram is in the
[architecture overview](architecture/overview.md#data-model).

### Rules and constraints

- Unique `(provider, provider_transaction_id)` for billing transactions, using each provider's correct
  transaction identity.
- Unique `(provider, event_id)` for webhook events, so repeated deliveries never create duplicate
  payments or duplicate subscription extensions.
- Unique store product identifiers within the right platform and storefront scope.
- Indexes on subscriptions by user, provider reference and status, and on playback sessions by user,
  device and active state.
- A cancelled renewal and an expired subscription are different states.
- Refunds and chargebacks are recorded, never erased from transaction history.
- Passwords, refresh tokens, store credentials and signing keys are never stored in plaintext (store
  hashes, or keep secrets out of the database entirely).
- Related billing and entitlement changes are applied in one database transaction.
- All timestamps in UTC; currency codes stored explicitly.
- Soft deletion or tombstones where needed to keep accounting and audit history intact.
- An audit trail for admin actions and important security events.

## 9. APIs

The API is versioned (`/v1`), JSON, documented with OpenAPI (emitted to
`packages/api-contracts/openapi.json`), validates every input, rate-limits, and returns stable error
codes that clients branch on.

**The full endpoint list, request/response types, error codes and environment variables are in the
[API contract](architecture/api-contract.md).** In summary it covers:

- **Auth and account:** register, login, refresh-token rotation (reuse revokes the whole session
  family), logout, current user, account deletion.
- **Catalog (public):** published, top-level content available in the viewer's country, and content
  details including lessons and subtitles.
- **Plans and subscriptions:** plan list, the normalized subscription view, and server-side purchase
  verification.
- **Devices:** list, register and revoke devices.
- **Playback:** create a playback session, heartbeat, end a session.
- **Webhooks:** App Store Server Notifications v2, Google Play RTDN, and a fake provider for
  development.
- **Admin (`/v1/admin/*`, admin role only):** content CRUD, upload sessions, publish/unpublish, user
  lookup, and revocation of login sessions, devices and playback sessions. Every admin write is audited.

Principles:

- The client can never set its own subscription status. `POST /v1/purchases/verify` takes only the
  store's purchase proof, and the server verifies it with the provider.
- Each webhook handler verifies the provider's signature or signed payload before processing anything,
  stores the event once, and applies changes idempotently. A public endpoint that accepted
  `{"subscriptionActive": true}` would be dangerously insecure.
- Catalog responses return only what the viewer may discover; entitlement is still checked
  independently when playback is requested.
- Authentication uses short-lived access tokens and rotating refresh tokens built on well-maintained
  libraries for password hashing and token signing. No home-made cryptography. On mobile, tokens live
  only in platform secure storage, and no server credentials are ever compiled into the app.

## 10. Admin dashboard and publishing workflow

The admin dashboard lets us change the catalog without shipping a new app.

- **Content management:** courses, lessons, standalone videos, descriptions, artwork, subtitles and
  language metadata.
- **Media processing:** upload progress, processing status, failed jobs, and whether a video is ready
  to publish.
- **Customer support:** look up an account, see its verified billing state, revoke compromised login
  sessions, devices or playback sessions, and investigate playback problems without exposing sensitive
  payment data.
- **Business and playback analytics (later):** active subscribers, cancellations, failed playback
  attempts, buffering, startup time and content popularity.

### Safe publishing workflow

1. An administrator creates a **draft** content record.
2. The backend creates a secure, short-lived **upload session**.
3. The original video is uploaded directly to the media provider's private storage.
4. Encoding, packaging and encryption run automatically (**processing**).
5. The backend receives a processing-completion event and marks the asset **ready** (or failed).
6. An administrator reviews the result.
7. The administrator **publishes** the content for the intended regions and access tier. Publishing a
   lesson or video without a ready asset is refused; a course container can publish without one.

## 11. Mobile app screens and experience

The first version focuses on the viewing journey rather than reproducing every feature of a large
streaming service.

- **Home and discovery:** featured content, new releases, continue watching, categories, language
  filters; personalized recommendations later.
- **Course and content detail:** description, lesson list in order, duration, subtitles, age rating
  and whether it is free or premium.
- **Video player:** adaptive quality, captions, audio-track selection, playback speed where
  appropriate, seeking and resume.
- **Subscription screen:** clearly states price (from the store), billing period, auto-renewal,
  included content, cancellation and terms before purchase.

The complete app also needs:

- Registration and login, plus password or account recovery.
- Search and content detail pages.
- Watch history and continue watching.
- Favorites or a watchlist.
- Caption and audio-language selection.
- Subscription status and restore purchases.
- Device management and sign-out from other devices.
- Privacy settings, account deletion, help and support.
- Proper loading, empty, offline and error states (including clear messages for each playback error
  code).

**Skip offline downloads in the first release.** Downloads add persistent DRM licenses, secure local
storage, expiry and renewal, and more device management.

## 12. India first, then worldwide

Build regional configuration into the data model from the start. Do not hardcode `INR`, one catalog
or one price anywhere in the app.

### India launch

- Prices shown in INR, billed through the appropriate store or provider.
- Indian payment methods supported by the chosen billing channel.
- Regional content availability and language metadata (for example Hindi and English).
- Low-bandwidth streaming and mobile-data awareness (lower renditions, quick startup).
- Local customer support and refund workflows.
- Applicable privacy, consumer-protection, tax and content obligations.
- Contributor agreements that explicitly permit streaming and distribution in India.

### International expansion

When entering a new market, add:

- Country-specific prices and currency.
- Localized store listings and support.
- Region-based content availability.
- Regional payment and tax handling.
- Country-specific privacy and consumer rules.
- Adequate CDN coverage and latency monitoring.
- Time-zone and language support.

Keep **content rights**, **user location** and **billing country** as separate concepts. A subscriber
may travel abroad while a particular video is only offered in India, so authorization follows the
content's availability policy instead of assuming every active subscription unlocks every video
everywhere. In this design the viewer's country comes from a trusted CDN header, never from the client.

## 13. Legal, privacy, tax and app-store rules

> **This is a technical and product plan, not legal or tax advice.** Have qualified Indian counsel and
> a tax professional review the content model, business structure and launch plan before going live.

| Area | What we need |
|---|---|
| Content rights | Even for our own originals: written agreements with every contributor, performer and editor covering ownership, music, distribution, territories, editing, promotional clips and international use. If third-party videos are ever licensed, confirm the rights include mobile streaming and DRM-protected delivery. |
| Privacy | Privacy policy, clear data-use disclosures, retention controls, account deletion and consent where required. |
| Indian data protection | Comply with the Digital Personal Data Protection Act, 2023 and the Digital Personal Data Protection Rules, 2025, following MeitY's official commencement timeline. |
| Taxes | GST registration, invoicing, accounting and the tax treatment of store and web revenue, decided with an Indian tax professional. |
| Consumer protection | Clear prices, renewal terms, cancellation flows, customer support and refund policies. |
| App stores | Developer accounts, subscription product setup, review compliance and accurate privacy declarations. |
| Security | Incident response, backups, access control, secret rotation and a breach-response process. |
| Content ratings | Appropriate age ratings, regional classification and platform-specific obligations. |

### DPDP Act and Rules, 2025

Use MeitY's published **Digital Personal Data Protection Rules, 2025** and its official timeline rather
than the 2025 draft or older summaries. The Rules were notified in November 2025 with phased
commencement: the Data Protection Board provisions applied first, and most operative obligations
(notice, consent, security safeguards, breach intimation, children's data) are scheduled to apply
later, around 2027. Which obligations have commenced on our launch date matters, so confirm the
current timeline at [MeitY: data protection framework](https://www.meity.gov.in/data-protection-framework).

Practical work regardless of the exact date:

- Map the personal data collected by the app and every third-party SDK.
- Write notices, record the lawful basis, and collect consent where required.
- Define retention, deletion and account-closure workflows (the API soft-deletes accounts and revokes
  sessions, devices and playback).
- Prepare processes for user data requests and for breach notification.

### GST

GST registration, invoicing and the treatment of subscription revenue (including revenue collected by
Apple and Google) depend on the business structure. Get professional advice before launch and before
adding web checkout.

### App-store rules

- Apple documents auto-renewable subscriptions and reader-app options separately; see the
  [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) and
  [Apple In-App Purchase](https://developer.apple.com/in-app-purchase/).
- Google documents its payments policy and alternative/user-choice billing (including India) and its
  reporting requirements; see the
  [Play payments policy](https://support.google.com/googleplay/android-developer/answer/10281818) and
  [user choice billing](https://support.google.com/googleplay/android-developer/answer/13821247).

Review these immediately before submitting the apps: implementation and eligibility details change.

## 14. Cost model

Streaming costs depend on both the size of the catalog and how much subscribers watch.

| Category | What drives it |
|---|---|
| Video storage | Master files, encoded renditions, subtitles, artwork |
| Encoding and packaging | Processing each new upload into streaming renditions (MediaConvert bills by normalized output minutes) |
| Video delivery | Usually the largest variable cost: viewing hours × average bitrate |
| DRM and security | DRM vendor fees or per-license charges, watermarking, monitoring, anti-abuse tooling |
| Application infrastructure | API hosting, database, logging, backups, monitoring, email, push, admin hosting |
| Business costs | App-store commissions, payment fees, production, support, taxes, marketing |

### Estimating delivery volume

```text
GB delivered ≈ (average delivered Mbps × viewing seconds) ÷ 8 ÷ 1,000
```

Worked example (all **estimates**): 20 viewing hours per subscriber per month at an average delivered
bitrate of 2.5 Mbps is 20 × 3,600 × 2.5 ÷ 8 ÷ 1,000 = **22.5 GB per subscriber per month**.

| Paying subscribers | Viewing hours / month | Estimated delivery / month |
|---:|---:|---:|
| 100 | 2,000 | ≈ 2,250 GB (2.25 TB) |
| 1,000 | 20,000 | ≈ 22,500 GB (22.5 TB) |
| 10,000 | 200,000 | ≈ 225,000 GB (225 TB) |

Decimal units, before protocol overhead and other traffic. To test other assumptions, the estimated
delivery per subscriber per month is:

| Viewing hours / subscriber | 1.5 Mbps | 2.5 Mbps | 4 Mbps |
|---:|---:|---:|---:|
| 10 h | ≈ 6.75 GB | ≈ 11.25 GB | ≈ 18 GB |
| 20 h | ≈ 13.5 GB | ≈ 22.5 GB | ≈ 36 GB |
| 40 h | ≈ 27 GB | ≈ 45 GB | ≈ 72 GB |

The invoice is the delivery volume times the provider's applicable rate, plus storage, encoding, DRM,
requests and other services. Managed video platforms may instead bill by minutes stored and minutes
delivered, so the formula estimates traffic, not the bill.

For CDN pricing, AWS publishes CloudFront flat-rate plans (at the time of writing, a Pro tier at about
$15 per month with a 50 TB data-transfer allowance and a request allowance). With segmented HLS, the
request allowance may run out before the transfer allowance, and a flat-rate CDN plan does not make
the whole stack $15: encoding, storage, DRM licenses and hosting are billed separately. Check the
current plan limits, feature support and terms on the
[CloudFront pricing page](https://aws.amazon.com/cloudfront/pricing/).

### The financial model must include

- [ ] Subscription revenue after taxes, store commissions and billing fees.
- [ ] Free trials and introductory discounts.
- [ ] Payment failures and refunds.
- [ ] Customer acquisition costs.
- [ ] Content production costs.
- [ ] Streaming cost per active subscriber.
- [ ] Support and operational expenses.
- [ ] A margin for unexpectedly popular videos and traffic spikes.

Do not choose a provider because its entry-level price is low. Calculate a conservative cost per
subscriber at realistic viewing levels and negotiate from projected usage.

## 15. Provider decision

Given original courses, a solo developer, India first and a strong DRM requirement, there were two
sensible paths.

### Option A: lean launch (managed video + custom subscription backend)

- Flutter for Android and iOS; NestJS for APIs and entitlement checks; PostgreSQL.
- Cloudflare Stream for managed encoding and delivery (priced by stored and delivered video minutes,
  with bandwidth included).
- Apple StoreKit and Google Play Billing; a small web admin panel.

Signed tokens restrict access but are **not** equivalent to DRM. Only suitable if the platform's
actual protection level is acceptable; if genuine Widevine and FairPlay DRM are mandatory, this
architecture should not ship until that gap is solved.

### Option B: DRM-first launch (custom backend + managed multi-DRM workflow)

- Flutter app using native players where necessary.
- NestJS and PostgreSQL for authentication, catalog, subscriptions and playback sessions.
- Private object storage (S3) for masters and packaged video.
- Managed transcoding and packaging (AWS Elemental MediaConvert).
- CloudFront as the CDN.
- A specialist DRM vendor that explicitly supports Widevine and FairPlay, with license-server
  integration.
- Server-side playback authorization and short-lived credentials.

### Decision: Option B

Strong DRM is non-negotiable for this project, so we take **Option B**, with as much of the media
workflow managed by providers as possible. The application backend stays small enough for one
developer. The DRM vendor is chosen only after the proof of concept in [§16](#16-drm-proof-of-concept-requirements).

Never implement our own encryption or invent a DRM protocol. Use established DRM systems and a vendor
that supports our target devices.

## 16. DRM proof-of-concept requirements

For the Android and web launch, the proof of concept must demonstrate the items below. Choose a
vendor that also supports FairPlay, so Safari and the iOS app do not force a vendor change.

- [ ] Android playback with Widevine on supported devices.
- [ ] Browser playback with Widevine through EME and Shaka Player in Chrome, Edge and Firefox.
- [ ] Encrypted DASH/HLS packaging for Widevine (confirm the vendor can add FairPlay later).
- [ ] Server-side DRM license issuance and authorization (license token issued only by our backend).
- [ ] Short-lived playback authorization that can be revoked or expire.
- [ ] No publicly accessible master files or unprotected premium renditions.
- [ ] Correct behavior after subscription expiry, refund, logout and device revocation.
- [ ] Compatibility with our Flutter app and its native Media3/ExoPlayer integration.
- [ ] Soon after launch: FairPlay in Safari (which also covers every browser on iPhone and iPad, since
  they all use Safari's engine), once Apple's FairPlay credentials are approved.
- [ ] iOS phase: FairPlay with AVPlayer in the iOS app.

DRM license duration and in-progress playback behavior are partly controlled by the DRM vendor and
the client. Our entitlement checks alone cannot guarantee that an already-issued license stops working
immediately, so license policy is part of the evaluation.

For a solo developer: **buy the difficult media-security components and build the business logic.**

## 17. Itemized budget (estimates)

These are planning estimates for India, not vendor quotes. They exclude the developer's own time and
the cost of producing the videos. Because the budget is still open, two launch strategies are compared.

### One-time development and setup (estimates, INR)

| Expense | Lean MVP | DRM-first MVP |
|---|---:|---:|
| Flutter app development | ₹0–₹50,000\* | ₹0–₹75,000\* |
| Backend and database setup | ₹0–₹30,000\* | ₹0–₹50,000\* |
| Admin dashboard | ₹0–₹20,000\* | ₹0–₹30,000\* |
| Video pipeline integration | ₹0–₹15,000\* | ₹15,000–₹75,000\* |
| DRM and player integration | Not included unless supported | ₹25,000–₹1,00,000\* |
| QA and security testing | ₹5,000–₹25,000 | ₹15,000–₹50,000 |
| Legal and business setup | ₹10,000–₹40,000 | ₹15,000–₹60,000 |
| **Indicative total** | **₹15,000–₹1.8 lakh** | **₹70,000–₹4.4 lakh** |

\* Assumes the software is mostly built in-house. These amounts are possible cash expenses for tools,
limited outsourced work, integration help and testing, not a market quote for hiring a team. The low
end assumes substantial do-it-yourself work and existing equipment.

Hiring a freelancer or agency for the full product would cost considerably more. A proper multi-DRM
integration can be a substantial specialist project; get a fixed-scope quote after the proof of
concept.

### Monthly operating costs (estimates, INR)

Indicative conversion for budgeting: ₹86 per US dollar. Actual exchange rates, taxes and provider
billing regions will differ.

| Expense | Early pilot | Growing service |
|---|---:|---:|
| API hosting | ₹0–₹3,000 | ₹3,000–₹15,000 |
| PostgreSQL | ₹0–₹3,000 | ₹3,000–₹15,000 |
| Video storage and delivery | ₹1,000–₹10,000 | ₹10,000–₹1,00,000+ |
| DRM provider | Quote required | Quote required |
| Monitoring, email and notifications | ₹0–₹2,000 | ₹2,000–₹10,000 |
| Backups and security tools | ₹0–₹2,000 | ₹2,000–₹10,000 |
| **Indicative subtotal (excluding DRM)** | **₹1,000–₹20,000+** | **₹20,000–₹1.5 lakh+** |

The ranges are deliberately broad. Delivery volume and the DRM contract can change the economics
dramatically, and the growing-service column is not a ceiling.

For the DRM-first architecture, keep these lines separate in the cost model:

1. CDN delivery and request costs.
2. Video storage.
3. Transcoding and packaging.
4. DRM license transactions or service fees.
5. Backend, database, monitoring and backups.
6. App-store commissions and payment-processing fees.

Do not sign a DRM or media contract until the provider has estimated costs against our expected
viewing hours, stored catalog, target countries and device mix.

## 18. App-store and developer account fees

| Item | Estimated cost |
|---|---|
| Apple Developer Program | US$99 per year. Needed for FairPlay credentials (Safari on the web, including iPhone and iPad browsers) and later the iOS app; enrolling early lets Safari users watch soon after launch (local pricing and enrollment requirements apply in India); see [Apple Developer Program](https://developer.apple.com/programs/) |
| Google Play Console | US$25 one-time registration; see [Get started with Play Console](https://support.google.com/googleplay/android-developer/answer/6112435). New personal accounts must run a closed test (at least 12 testers for 14 days) before production; organization accounts need a D-U-N-S number instead. Confirm the current rules. |
| Razorpay | No store commission; a per-transaction gateway fee applies (commonly around 2% plus GST for domestic payments). Subscriptions must be enabled on the account after KYC. Confirm current pricing. |
| DRM vendor | Vendor-specific; get a quote |
| Domain | About ₹800–₹2,000 per year as a planning allowance |
| Email and monitoring | Often free tiers at first |
| Legal and accounting | Depends on business structure and services needed |

These do not include **store commissions on subscription revenue**, which must be modeled separately
(commonly in the 15–30% range depending on the program and how long a subscriber has been paying;
confirm current rates with each store).

## 19. Roadmap

For a small, experienced team using managed services, a basic MVP might take roughly 10–16 weeks. A
production-grade multi-DRM service with polished apps and store integrations can take longer. These
are planning estimates, not guarantees; several phases overlap.

| Phase | Weeks (estimate) | Work |
|---|---|---|
| 1. Product definition and proof of concept | 1–2 | Finalize audience and content rights, define free vs premium, select the video provider and evaluate DRM, test playback on representative devices, build a simple cost model. |
| 2. Backend foundation | 2–4 | Environments, database, authentication, APIs, catalog and admin upload workflow, entitlement model, logging, secrets, backups, monitoring. |
| 3. Mobile application | 4–7 | Registration, login, home, search, details, playback, watch history, captions, player errors, subscription screens, account management, analytics and crash reporting. |
| 4. Billing and content security | 6–10 | Google Play subscriptions (Apple with the iOS phase), server-side verification, signed notifications, playback authorization, signed access and DRM, device and concurrent-stream limits. |
| 5. QA, security and operational readiness | 9–13 | Renewal, cancellation, expiry, refund and restore tests; poor networks, backgrounding, device changes; security testing proving unauthorized playback fails; privacy disclosures, support and store submissions. |
| 6. India launch and controlled rollout | 13–16 | Small beta, monitor startup time, buffering, playback errors and conversion, fix critical issues, review real costs and feedback before scaling marketing. |

Do not skip the proof of concept. Discovering late that the chosen video provider cannot meet the DRM
requirements forces expensive architectural changes.

### Platform rollout and timeline

Launch order: **Android and web together**, then iOS if the launch is profitable. Writing the code is
not the slow part: the calendar is driven by vendor onboarding, store and payment-account approvals,
and testing on real devices and browsers. All figures are estimates.

**Phase 1: Android and web (launch)**

| Track | Estimate | Notes |
|---|---:|---|
| Code complete for Android | 2–3 weeks | Real Google Play verification and RTDN, the AWS media pipeline, the Media3 Widevine player, polish and tests. The backend, admin dashboard and app foundation already exist. |
| Code complete for the web | 2–3 weeks, in parallel | Server-rendered catalog pages, sign-in, Razorpay checkout and webhooks, the Shaka Player web player with browser DRM. Shares the same backend. |
| DRM vendor quotes, contract and account | 1–3 weeks | Runs in parallel with the coding. |
| Razorpay account, KYC and Subscriptions enabled | days to 2 weeks | Needs business and bank details. |
| Google Play Console setup | days to 2 weeks | Organization accounts need a D-U-N-S number. |
| Closed test (new personal Play accounts) | 14+ days | At least 12 opted-in testers for 14 consecutive days before production access; confirm current rules. The web has no equivalent gate. |
| DRM testing on real Android phones and desktop browsers | about 1 week | Including low-end phones, slow networks, Chrome, Edge and Firefox. |
| Play review | hours to a few days | New apps and accounts can take longer. |

| Scenario | Time to a public launch |
|---|---:|
| Best case: accounts and vendor started in week 1, DRM works early | about 4 weeks |
| Likely | 5–6 weeks |
| Risk case: vendor or DRM integration needs several rounds of fixes | about 8 weeks |

The website can go live as soon as it passes testing, possibly a week or two before Android if the
Play closed test is the bottleneck.

**Safari (soon after launch).** Safari, and every browser on iPhone and iPad, needs FairPlay. That
requires Apple Developer enrollment and FairPlay Streaming credentials from Apple (1–3 weeks). Until
then, the website tells those visitors to use Chrome, Edge, Firefox or the Android app. Starting the
Apple enrollment in week 1 shortens this gap.

**Phase 2: iOS app.** StoreKit purchases with App Store Server API verification and notifications,
AVPlayer FairPlay playback, and a Mac with Xcode for builds. Estimate: 3–4 weeks of build and testing,
plus any Apple approvals not already done for Safari.

DRM integration and store-policy issues remain the most likely causes of delay.

## 20. Launch plan (week by week)

A target for a controlled Android and web release in India, assuming the store, payment and vendor
accounts start in week 1. Allow extra time if the DRM vendor's Media3 or browser integration needs
more work.

### Week 1: remove the big risks

- Register the Google Play Console account, an AWS account and a Razorpay account (start KYC).
- Optional but recommended: start Apple Developer enrollment so FairPlay for Safari can follow soon.
- Request quotes from two or three multi-DRM vendors (Widevine now for Android and browsers;
  FairPlay soon after).
- Prepare 3–5 representative sample videos and confirm the subscription model.
- Play a Widevine-encrypted sample on a real Android phone with Media3 and in desktop Chrome with
  Shaka Player.

### Week 2: real integrations

- Google Play Billing in the app, server-side verification with the Play Developer API, and RTDN
  webhooks.
- AWS pipeline: private S3 uploads, MediaConvert packaging with the DRM vendor's keys, CloudFront
  signed delivery.
- The Media3/ExoPlayer Widevine player behind the app's player abstraction.
- Razorpay subscriptions on the web: checkout, signature verification and webhooks.
- The web player with Shaka Player, browser DRM detection, heartbeats and the viewer watermark.

### Week 3: harden and test

- Subscription edge cases: renewal, cancellation, grace period, expiry, refund and restore.
- Security checks: expired and replayed credentials, forged purchases, device and stream limits,
  revocation.
- Privacy policy, terms, refund policy, the Play data-safety form and the content rating.
- Web: page metadata and sitemap for search, the Content-Security-Policy, and checks in Chrome, Edge
  and Firefox.
- Staging and production environments with backups and monitoring.

### Weeks 3–5: closed test and fixes

- Run the Play closed test (14 days with at least 12 testers for new personal accounts).
- The website can go live in this window once it passes testing; it has no closed-test gate.
- Test on low-end phones and slow networks, and fix what the testers find.

### Weeks 5–6: launch

- Production release in India on Android and the web, starting with a staged rollout.
- Watch playback failures, startup time, conversion and real delivery costs before scaling marketing.

If the DRM player integration turns out to be unstable, extend the timeline rather than weakening the
security requirements to hit an arbitrary date.

## 21. Testing and deployment checklists

Testing covers much more than the UI.

### Pre-launch checklist

**Subscription integrity**

- [ ] Fake purchase responses never unlock content.
- [ ] Duplicate and out-of-order webhooks are handled safely.
- [ ] Expired, refunded and revoked purchases lose access correctly.
- [ ] Restore purchases works after reinstall and on another device.
- [ ] Billing-provider outages never grant unverified access.

**Video security**

- [ ] Direct public access to protected videos is blocked.
- [ ] Expired or invalid playback credentials are rejected.
- [ ] DRM license requests enforce the authorization policy.
- [ ] Device and simultaneous-stream limits are enforced.
- [ ] Master video files and signing secrets are never exposed.

**Playback quality**

- [ ] Adaptive quality works on slow and fast networks.
- [ ] Playback resumes after the app is backgrounded.
- [ ] Captions and audio tracks work on supported devices.
- [ ] Expired or unavailable content shows a useful error.
- [ ] Low-memory devices and the oldest supported OS versions are tested.

**Production readiness**

- [ ] Database backups and restore procedures are tested.
- [ ] API errors and suspicious activity are monitored.
- [ ] Admin access uses strong authentication and least privilege.
- [ ] Privacy policy and account-deletion flows work.
- [ ] Load tests cover the expected peak of concurrent playback sessions.

### Environments

Keep development, staging and production separate (see [`infrastructure/README.md`](../infrastructure/README.md)):

- **Development:** test accounts, sample videos, fake or sandbox purchases.
- **Staging:** production-like configuration, test content and store sandbox testing.
- **Production:** real accounts, billing, published content, production secrets, monitoring and
  tested backups.

Never use production signing keys or live payment credentials in development builds. Keep deployment
credentials in a secret manager and require review before production changes.

## 22. India launch checklist

The work first-time subscription businesses most often forget.

**Business and content rights**

- [ ] Choose a business structure and separate business finances.
- [ ] Confirm the rights to stream every video in the intended territory.
- [ ] Prepare content-owner and contributor agreements.
- [ ] Publish Terms of Use, a Privacy Policy and refund/cancellation disclosures.
- [ ] Get professional advice on GST, invoicing and applicable taxes.

**India privacy and compliance**

- [ ] Map the personal data collected by the app and every third-party SDK.
- [ ] Document lawful processing grounds, notices and consent where required.
- [ ] Define data retention, deletion and account-closure workflows.
- [ ] Review the DPDP Act and the Digital Personal Data Protection Rules, 2025, including the
      applicable commencement timeline.
- [ ] Prepare a process for data-principal requests and security incidents.

**Store accounts and subscriptions**

- [ ] Register the Apple Developer and Google Play Console accounts.
- [ ] Configure subscription products, durations, prices and storefront availability.
- [ ] Implement server-side transaction verification and notification processing.
- [ ] Test cancellation, renewal, expiry, refund and restore-purchases flows.
- [ ] Verify the current app-store rules for external payments and account links.

**Video and security**

- [ ] Validate Widevine and FairPlay playback on real devices.
- [ ] Verify private origins and protected manifests and segments.
- [ ] Test expired credentials, DRM license errors and revoked sessions.
- [ ] Configure device limits, abuse alerts, backups and audit logging.
- [ ] Run a security review before publishing premium content.

**Operations and launch**

- [ ] Prepare customer support and a refund-escalation process.
- [ ] Configure crash reporting and playback-quality monitoring.
- [ ] Test on slow mobile networks and lower-end Android devices.
- [ ] Complete app-store privacy declarations and age/content ratings.
- [ ] Run a limited beta and review actual delivery costs before marketing.

For privacy, use MeitY's published Rules and official timeline
([data protection framework](https://www.meity.gov.in/data-protection-framework)). For store billing,
use Apple's and Google's current documentation (see [Official references](#official-references))
immediately before submission.

## 23. Post-launch metrics

The app is not finished when it reaches the stores. We need to know whether people can watch, whether
they pay, and whether the economics work.

| Metric | What it tells us |
|---|---|
| Video startup time | How quickly playback begins |
| Rebuffering ratio | How much playback time is lost to buffering |
| Playback failure rate | How often viewing fails |
| Subscription conversion | How many eligible visitors become paying subscribers |
| Monthly recurring revenue | The recurring revenue trend |
| Churn rate | How many subscribers leave |
| Renewal success rate | Whether renewals succeed |
| Streaming cost per subscriber | Whether usage is financially sustainable |
| Support tickets per 1,000 viewers | Where users hit friction |
| Unauthorized playback denials | Whether security controls are catching abuse (by error code) |

Analytics must avoid collecting unnecessary personal data: the aim is operational visibility, not a
record of everything every user does.

## 24. What to do in the first seven days

Don't start by building every screen. Start with the highest-risk question: can we deliver
DRM-protected video reliably on Android and in browsers at a cost the business can afford?

- **Day 1, define the product:** decide whether the subscription unlocks the whole course library or
  individual categories (the v1 contract assumes a single premium tier), and prepare 3–5
  representative sample videos.
- **Day 1, also:** register the Google Play Console account (decide personal or organization), an
  AWS account and a Razorpay account (start KYC), so the slow approvals start early. Consider
  starting Apple Developer enrollment too, for FairPlay in Safari.
- **Days 2–3, evaluate DRM vendors:** request quotes for Widevine now (Android and browsers),
  and confirm FairPlay support for Safari and the iOS app; ask about minimum
  commitments, per-license charges, Flutter/native player support and delivery in India. Do not commit
  before testing the player.
- **Days 4–5, build a technical proof of concept:** play one encrypted sample video on a real
  Android phone and in desktop Chrome; test license failure, expired authorization and playback on a slow connection.
- **Days 6–7, finalize the budget:** estimate monthly delivery costs at 100, 1,000 and 10,000
  subscribers (see [§14](#14-cost-model)), including DRM, storage, store fees, payment costs and taxes.

## 25. Final recommendation

Do not try to build global, large-scale infrastructure immediately. Build a secure, well-designed
streaming product on the right foundations.

- **Build now:** the Flutter Android app, the Next.js viewer website, the NestJS backend, PostgreSQL,
  the admin dashboard, the managed video pipeline, catalog management, Google Play and Razorpay
  subscriptions, and the normalized entitlement system.
- **Include in the initial security design:** server-side purchase verification, private video
  assets, short-lived playback authorization, secure secrets management, device limits, audit logs
  and DRM.
- **Add as the business grows:** FairPlay for Safari (as soon as Apple approves it), the iOS app if
  the launch is profitable, then forensic watermarking, offline viewing, recommendations, more
  regions, TV apps, more sophisticated fraud detection and customized media infrastructure where
  justified.

**The stack:** Flutter + NestJS + PostgreSQL + AWS media infrastructure + a specialist multi-DRM
vendor, subject to a successful Android and web proof of concept. Keep the backend a modular monolith,
use store billing in the app and Razorpay on the web, and keep the entitlement system independent of the
payment provider. Launch in India first, then expand through configuration-driven pricing and
region-specific content availability.

**The first milestone is not a finished app.** It is a small working demonstration that a paying user
can watch an encrypted video on an Android phone and in a desktop browser, while an unauthorized user cannot obtain a new
playback authorization. Once that works, the rest of the product is much more straightforward.

## Official references

- Apple: [In-App Purchase](https://developer.apple.com/in-app-purchase/),
  [App Store Server API](https://developer.apple.com/documentation/appstoreserverapi),
  [App Store Server Notifications](https://developer.apple.com/documentation/appstoreservernotifications),
  [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/),
  [FairPlay Streaming](https://developer.apple.com/streaming/fps/),
  [Apple Developer Program](https://developer.apple.com/programs/)
- Google: [Google Play Billing](https://developer.android.com/google/play/billing),
  [Real-time developer notifications reference](https://developer.android.com/google/play/billing/rtdn-reference),
  [Play payments policy](https://support.google.com/googleplay/android-developer/answer/10281818),
  [User choice billing](https://support.google.com/googleplay/android-developer/answer/13821247),
  [Play Console registration](https://support.google.com/googleplay/android-developer/answer/6112435),
  [Media3 ExoPlayer DRM](https://developer.android.com/media/media3/exoplayer/drm)
- MeitY: [Data protection framework (DPDP Act and Rules)](https://www.meity.gov.in/data-protection-framework)
- AWS: [CloudFront pricing](https://aws.amazon.com/cloudfront/pricing/)
