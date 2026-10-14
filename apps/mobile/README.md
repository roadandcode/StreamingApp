# StreamingApp mobile (Flutter)

The subscriber app: sign in, browse the catalog, watch videos and courses, subscribe through the
store, and manage devices. It is built strictly against
[`docs/architecture/api-contract.md`](../../docs/architecture/api-contract.md).

**Android is the launch platform.** The project stays cross-platform (the `ios/` folder is kept and
the code has Apple paths behind the same abstractions), but iOS is planned for a later release and
has not been built or tested yet.

## Security model

- The app never decides entitlement. Lock icons come from `SubscriptionView.hasAccess` and are hints
  only; every playback is authorized by `POST /v1/playback/sessions`, and the player stops on any
  `403` from the playback API (start or heartbeat).
- Subscription status comes only from `GET /v1/me/subscription`, so access is per account no matter
  where it was bought. Google Play policy: the Android app shows only plans sold on Google Play and
  must never mention, link to or price any other way to buy (paywall, account screen and errors
  included).
- `POST /v1/playback/sessions` sends `supportedDrm` (`["widevine"]` on Android).
- Tokens and the per-install `installationId` live in platform secure storage
  (`flutter_secure_storage`). Tokens, manifest URLs and DRM tokens are never logged.
- Android: `FLAG_SECURE` blocks screenshots and screen recording; app data is excluded from backup
  and device transfer; cleartext HTTP is allowed **only in debug builds** and only to `10.0.2.2` and
  `localhost` (`android/app/src/debug/res/xml/network_security_config.xml`). Release builds are
  HTTPS-only.
- iOS (later): App Transport Security stays on; the only exception is `NSAllowsLocalNetworking` for
  a local development API.

## Run against a local API

Start the API from the repository root (see the root README), then:

```bash
cd apps/mobile
flutter pub get

# Android emulator (10.0.2.2 is the host machine)
flutter run \
  --dart-define=API_BASE_URL=http://10.0.2.2:3000 \
  --dart-define=FAKE_BILLING=true

# Physical Android device over USB: forward the port and use localhost
adb reverse tcp:3000 tcp:3000
flutter run --dart-define=API_BASE_URL=http://localhost:3000 --dart-define=FAKE_BILLING=true
```

| Define | Default | Meaning |
|---|---|---|
| `API_BASE_URL` | `http://10.0.2.2:3000` (Android), `http://localhost:3000` (iOS) | API origin, without `/v1` |
| `FAKE_BILLING` | `false` | Shows "Simulate purchase (dev)" on the paywall |
| `REQUIRE_DRM` | `false` | Refuse any playback authorization whose `drm` is `null` |

Plain HTTP only works in debug builds. Profile and release builds need an `https://` API.

The fake media provider builds manifest URLs from the API's `PUBLIC_API_BASE_URL`. The device must
be able to reach that address: on the emulator start the API with
`PUBLIC_API_BASE_URL=http://10.0.2.2:3000`, or use `adb reverse` with `localhost` as above.

## What works with the fake providers

- Register, sign in, session restore on launch, silent token refresh (single-flight, rotated
  refresh token persisted), sign-out, account deletion.
- Device registration after sign-in, the "too many devices" screen (remove a device, then retry),
  and sign-out with an explanation when this device was revoked.
- Catalog rails, content details with ordered lessons, premium lock hints and the paywall.
- Playback of the fake provider's unprotected HLS stream (`drm: null`) with `video_player`,
  heartbeats every `heartbeatIntervalSeconds`, pause and heartbeat suspension in the background,
  immediate stop on any `403`, and `DELETE` of the session when leaving the player.
- `FAKE_BILLING=true`: "Simulate purchase (dev)" sends
  `{provider: "fake", productId: "fake_premium_monthly", receipt: <random uuid>}` to
  `POST /v1/purchases/verify` (the product id comes from the plan's `fake` store product when
  `/v1/plans` lists one) and unlocks premium for the account.

## Still to do on a real machine

- **Native DRM (Android first).** `NativeDrmPlayer` is a stub on the
  `com.roadandcode.streamingapp/drm_player` channel that reports "not implemented yet". Widevine
  playback with Media3 ExoPlayer must be written in Kotlin (see the TODOs in
  `lib/features/player/native_drm_player.dart` and `MainActivity.kt`). Ship production builds with
  `--dart-define=REQUIRE_DRM=true` so an unprotected stream is never played. FairPlay with AVPlayer
  follows with the iOS release.
- **Google Play Billing.** Create the subscription products in Play Console with the ids returned
  by `GET /v1/plans` (`provider: "google"`), upload a signed build to a testing track, add license
  testers, and configure the API's live Google verification. The app sends the Play
  `purchaseToken` as `receipt` and calls `completePurchase` only after the server accepts it.
  Prices shown are the store's localized prices.
- **Release signing.** `android/app/build.gradle.kts` still signs release builds with the debug key;
  add an upload keystore (kept out of git) before publishing.
- **Build verification.** This branch was checked with `flutter analyze` and `flutter test` only; build
  an APK/App Bundle (`flutter build appbundle`) and run on a device or emulator before release.

## Checks

```bash
flutter analyze
flutter test
```

## Layout

```
lib/
  main.dart, app.dart, router.dart   entry point, dark theme, routes with session redirects
  core/config.dart                   --dart-define configuration
  core/api/                          dio client, auth/refresh interceptor, ApiException, models
  core/storage/secure_store.dart     tokens and installationId in secure storage
  core/session/                      sign-in state, restore, expiry, device registration
  core/device/                       device registration, device list, device-limit screen
  features/auth|catalog|content|player|subscription|account
test/                                unit and widget tests (no network needed)
```
