# Local development

How to run the API, the admin dashboard and the mobile app on one machine, using the fake media and
fake billing providers instead of AWS, a DRM vendor, Apple and Google.

> The API, admin dashboard and mobile app are being built in parallel. The package names, scripts and
> environment variables below follow the [API contract](../architecture/api-contract.md); exact script
> names will be confirmed once that work is merged. When this guide and the contract disagree, the
> contract wins.

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 22 | Pinned in `.nvmrc` (`nvm use`) |
| pnpm | 10 | `corepack enable` picks up the version pinned in `package.json` |
| PostgreSQL | 16 | Or Docker, to run `docker compose up -d` |
| Flutter | stable channel | Plus Android Studio with an emulator and/or Xcode with an iOS simulator (macOS only) |
| `curl`, `openssl`, `jq` | any recent | Only for the examples in this guide |

## 1. Install dependencies

```bash
corepack enable
pnpm install
```

## 2. Start PostgreSQL

```bash
docker compose up -d
```

This starts PostgreSQL 16 on `localhost:5432` with user and password `streaming` and the database
`streaming_dev`. On the first start, `infrastructure/database/init/01-test-db.sql` also creates
`streaming_test`, which the end-to-end tests use. These credentials are for local development only.

Using your own PostgreSQL 16 instead? Create a `streaming` role and both databases, then point
`DATABASE_URL` at them.

## 3. Configure the API

```bash
cp services/api/.env.example services/api/.env
```

Fill in the values that have no default. Every variable, with its default, is listed in the contract's
[environment variable table](../architecture/api-contract.md#environment-variables-api). For local work
the important ones are:

| Variable | Local value |
|---|---|
| `DATABASE_URL` | `postgres://streaming:streaming@localhost:5432/streaming_dev` |
| `JWT_ACCESS_SECRET` | At least 32 characters, for example the output of `openssl rand -hex 32` |
| `MEDIA_PROVIDER` | `fake` |
| `FAKE_MEDIA_SIGNING_SECRET` | Any random value, for example `openssl rand -hex 32` |
| `BILLING_MODE` | `fake` |
| `FAKE_WEBHOOK_SECRET` | Any random value; you need it again to sign test webhooks |
| `PUBLIC_API_BASE_URL` | `http://localhost:3000` (see [Troubleshooting](#troubleshooting) for emulators and devices) |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | The admin account the seed script creates |

`services/api/.env` is git-ignored. Never commit real secrets, and never reuse these values outside
your machine.

## 4. Run the API

```bash
pnpm --filter @streamingapp/api db:migrate   # apply migrations to streaming_dev
pnpm --filter @streamingapp/api db:seed      # admin user, plans, sample courses
pnpm --filter @streamingapp/api dev          # http://localhost:3000, OpenAPI UI at /docs
```

Check it is up:

```bash
curl -sS http://localhost:3000/v1/health
# {"status":"ok","db":"ok"}
```

Other API commands:

| Command | What it does |
|---|---|
| `pnpm --filter @streamingapp/api test` | Unit tests |
| `pnpm --filter @streamingapp/api test:e2e` | End-to-end tests against `streaming_test` |
| `pnpm --filter @streamingapp/api openapi:emit` | Writes `packages/api-contracts/openapi.json` from the running code |

After any API change, run `openapi:emit` and commit the updated `openapi.json` with the change so the
generated TypeScript types and the clients stay in step.

## 5. Seeded data

`db:seed` creates (exact contents to be confirmed after merge):

- An **admin** user with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`.
- Two plans: **`premium_monthly`** (`P1M`) and **`premium_yearly`** (`P1Y`), each with a `fake` store
  product. `GET /v1/plans` shows the exact product ids.
- A **free course** and a **premium course** with lessons, published for `IN`, so you can exercise
  both the open path and the entitlement check.

## 6. Run the admin dashboard

```bash
export API_BASE_URL=http://localhost:3000
export SESSION_COOKIE_SECRET="$(openssl rand -hex 32)"
pnpm --filter @streamingapp/admin-web dev    # http://localhost:3001
```

You can also put both variables in `apps/admin-web/.env.local` (git-ignored). Sign in with the seeded
admin account. The API's default `CORS_ORIGINS` already allows `http://localhost:3001`. API tokens are
kept in httpOnly cookies by the dashboard's own route handlers, so you will not see them in browser
storage.

## 7. Run the mobile app

```bash
cd apps/mobile
flutter pub get

# Android emulator (10.0.2.2 is the host machine as seen from the emulator)
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3000 --dart-define=FAKE_BILLING=true

# iOS simulator
flutter run --dart-define=API_BASE_URL=http://localhost:3000 --dart-define=FAKE_BILLING=true
```

- `FAKE_BILLING=true` makes the app use the fake billing path (it sends `provider: "fake"` to
  `POST /v1/purchases/verify`) instead of StoreKit or Play Billing.
- With the fake media provider, `drm` is always `null` and the player is redirected to a public,
  unprotected test HLS stream. DRM playback can only be tested once a real DRM vendor is integrated.
- On a physical phone, use your computer's LAN address (for example `http://192.168.1.20:3000`)
  instead.

## 8. The fake providers

The fakes exist so the whole flow can be exercised without any external account. The API refuses to
start with either fake when `NODE_ENV=production`, and `/v1/dev/*` and `/v1/webhooks/fake` are never
mounted in production.

### Fake media

- **Upload.** `POST /v1/admin/content/:id/upload-session` returns an `uploadUrl` of the form
  `{PUBLIC_API_BASE_URL}/v1/dev/media/uploads/{providerAssetId}?exp=<unix>&sig=<hex>`. A `PUT` with any
  body marks the asset `ready`, simulating upload plus transcoding:

  ```bash
  curl -sS -X PUT --data-binary @sample.mp4 "$UPLOAD_URL"
  ```

- **Playback.** `POST /v1/playback/sessions` returns a `manifestUrl` of the form
  `{PUBLIC_API_BASE_URL}/v1/dev/media/{providerAssetId}/manifest.m3u8?sid=<playbackSessionId>&exp=<unix>&sig=<hex>`.
  A valid, unexpired URL answers `302` to `FAKE_SAMPLE_MANIFEST_URL`; an expired or altered one answers
  `401 INVALID_SIGNATURE`.
- `sig` is a hex HMAC-SHA256 made with `FAKE_MEDIA_SIGNING_SECRET`, so URLs cannot be forged or
  extended without the server.

### Fake billing

- **Simulate a purchase.** `POST /v1/purchases/verify` with `provider: "fake"`. The `receipt` is used as
  the subscription's original transaction id, and `productId` must be a fake store product from
  `GET /v1/plans`. The subscription becomes `active` for one billing period from now.
- **Simulate store events.** `POST /v1/webhooks/fake` with body
  `{ eventId, type, originalTransactionId, expiresAt? }`, where `type` is one of `RENEWED`, `CANCELLED`,
  `EXPIRED`, `REFUNDED`, `REVOKED`, `GRACE_PERIOD`, `BILLING_RETRY`, and header
  `X-Fake-Signature` set to the hex HMAC-SHA256 of the **raw body** with `FAKE_WEBHOOK_SECRET`. A bad
  signature gets `401 INVALID_SIGNATURE`; repeating an `eventId` gets `200 { "duplicate": true }` and
  changes nothing.

### End-to-end walkthrough with curl

Run from the repository root with the API running.

```bash
API=http://localhost:3000

# 1. Register a viewer and keep the access token
ACCESS=$(curl -sS -X POST "$API/v1/auth/register" \
  -H 'Content-Type: application/json' \
  -d '{"email":"viewer@example.com","password":"local-dev-password"}' | jq -r '.tokens.accessToken')

# 2. Register a device (the app does this once per installation)
INSTALLATION_ID=$(node -e 'console.log(crypto.randomUUID())')
DEVICE_ID=$(curl -sS -X POST "$API/v1/me/devices" \
  -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' \
  -d "{\"installationId\":\"$INSTALLATION_ID\",\"platform\":\"android\",\"name\":\"Local test\"}" | jq -r '.id')

# 3. Pick a lesson from the premium course (find its id via /v1/catalog and /v1/content/:id)
CONTENT_ID=<premium lesson id>

# 4. Without a subscription, playback is refused: 403 ENTITLEMENT_REQUIRED
curl -sS -X POST "$API/v1/playback/sessions" \
  -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' \
  -d "{\"contentId\":\"$CONTENT_ID\",\"deviceId\":\"$DEVICE_ID\"}"

# 5. Simulate a purchase of premium_monthly through the fake store
PRODUCT_ID=$(curl -sS "$API/v1/plans" | jq -r \
  '[.[] | select(.code=="premium_monthly") | .storeProducts[] | select(.provider=="fake")][0].productId')
curl -sS -X POST "$API/v1/purchases/verify" \
  -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' \
  -d "{\"provider\":\"fake\",\"productId\":\"$PRODUCT_ID\",\"receipt\":\"fake-txn-0001\"}"
# -> SubscriptionView with "status":"active" and "hasAccess":true

# 6. Playback is now authorized
SESSION=$(curl -sS -X POST "$API/v1/playback/sessions" \
  -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' \
  -d "{\"contentId\":\"$CONTENT_ID\",\"deviceId\":\"$DEVICE_ID\"}")
SESSION_ID=$(echo "$SESSION" | jq -r '.playbackSessionId')
curl -sSI "$(echo "$SESSION" | jq -r '.manifestUrl')"     # -> 302 to the sample stream
```

Now send a signed fake webhook that expires the subscription. The secret must match the one in
`services/api/.env`, and the body must be sent byte-for-byte as it was signed:

```bash
export FAKE_WEBHOOK_SECRET="$(grep '^FAKE_WEBHOOK_SECRET=' services/api/.env | cut -d= -f2-)"

BODY='{"eventId":"evt-0001","type":"EXPIRED","originalTransactionId":"fake-txn-0001"}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$FAKE_WEBHOOK_SECRET" | awk '{print $NF}')

curl -sS -X POST "$API/v1/webhooks/fake" \
  -H 'Content-Type: application/json' \
  -H "X-Fake-Signature: $SIG" \
  --data-raw "$BODY"
# Sending the same request again returns {"duplicate":true}
```

The next heartbeat for the session from step 6 is refused and the session is revoked:

```bash
curl -sS -X POST "$API/v1/playback/sessions/$SESSION_ID/heartbeat" \
  -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' -d '{}'
# -> 403 ENTITLEMENT_REQUIRED; a further heartbeat -> 403 PLAYBACK_SESSION_ENDED
```

Use a new `eventId` for every event you want applied. `printf '%s'` avoids a trailing newline; if you
pretty-print or re-serialize the JSON after signing, the signature no longer matches.

## Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| `pnpm: command not found` | Run `corepack enable`. |
| Engine or syntax errors during install | Wrong Node version; run `nvm use` (Node 22). |
| `pnpm install` warns that build scripts were ignored | pnpm 10 only runs install scripts for packages listed under `onlyBuiltDependencies` in `pnpm-workspace.yaml`. Add a package there only if it really needs its script. |
| Port 5432 already in use | Stop the other PostgreSQL, or change the port mapping in `docker-compose.yml` and `DATABASE_URL`. |
| `database "streaming_test" does not exist` | The init script only runs when the Docker volume is first created. Run `docker compose exec postgres createdb -U streaming streaming_test`, or `docker compose down -v` (this deletes local data) and start again. |
| API exits on start-up | Check `services/api/.env`: `JWT_ACCESS_SECRET` must be at least 32 characters, and `FAKE_MEDIA_SIGNING_SECRET` / `FAKE_WEBHOOK_SECRET` are required in fake modes. With `NODE_ENV=production` the fakes are refused by design. |
| `503 PROVIDER_NOT_CONFIGURED` | You are using `apple`, `google`, `MEDIA_PROVIDER=aws` or `BILLING_MODE=live`. Locally, use the fakes. |
| Empty catalog | Run `db:seed`. The viewer's country defaults to `DEFAULT_COUNTRY_CODE` (`IN`), so content must be published and available in `IN`. |
| Android emulator cannot reach the API | Use `http://10.0.2.2:3000`, not `localhost`. If the app reports that cleartext HTTP is not permitted, the debug build needs a cleartext exception for the development host. |
| iOS refuses plain HTTP | The debug build needs an App Transport Security exception for local networking. |
| App gets a manifest or upload URL it cannot open | Fake URLs are built from `PUBLIC_API_BASE_URL`. `localhost` means the emulator or phone itself; set it to your computer's LAN address (reachable from the host, emulators and phones) and restart the API. |
| `401 INVALID_SIGNATURE` on a manifest URL | It expired (`PLAYBACK_AUTH_TTL_SECONDS`, default 300) or was altered. Create a new playback session. |
| `401 INVALID_SIGNATURE` on a fake webhook | Secret mismatch, or the body changed after signing (trailing newline, pretty-printing, shell quoting). |
| `403 CONTENT_NOT_PLAYABLE` | The content is a course container, or its asset is not `ready`. Pick a lesson, or create an upload session in the admin dashboard and `PUT` any file to the fake upload URL. |
| `403 DEVICE_NOT_REGISTERED` | Register the device first; reinstalling the app creates a new `installationId`. |
| `403 CONCURRENT_STREAM_LIMIT` | End old sessions with `DELETE /v1/playback/sessions/:id`, or wait three heartbeat intervals (90 seconds by default) until they go stale. |
| `409 DEVICE_LIMIT_REACHED` | Revoke a device with `DELETE /v1/me/devices/:id` or from the admin dashboard. |
| Admin dashboard keeps returning to login | `SESSION_COOKIE_SECRET` or `API_BASE_URL` is missing or wrong, or the API is not running. |
