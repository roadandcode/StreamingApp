# StreamingApp

An India-first subscription video-streaming platform, launching on Android and the web, with iOS to
follow. Subscribers watch original videos and courses, and playback is authorized only by the backend.

## Repository layout

| Path | What it is |
|---|---|
| `services/api` | NestJS + PostgreSQL backend: auth, catalog, subscriptions, entitlements, playback authorization, devices, webhooks, admin APIs |
| `apps/web` | Next.js viewer website: public catalog pages, sign-in, Razorpay subscriptions, DRM web player |
| `apps/admin-web` | Next.js admin dashboard: content, uploads, publishing, user support |
| `apps/mobile` | Flutter app (Android at launch; iOS later from the same codebase) |
| `packages/api-contracts` | OpenAPI spec emitted by the API, plus generated TypeScript types |
| `docs/` | Project plan, architecture, API contract, security and operations notes |
| `infrastructure/` | Local database setup and deployment notes |

Start with [`docs/PROJECT_PLAN.md`](docs/PROJECT_PLAN.md) for the full product plan and
[`docs/architecture/api-contract.md`](docs/architecture/api-contract.md) for the API every client
builds against.

## Prerequisites

- Node.js 22 and pnpm 10 (`corepack enable`)
- PostgreSQL 16 (`docker compose up -d` starts one locally)
- Flutter (stable) for the mobile app

## Quick start

```bash
pnpm install
docker compose up -d                 # Postgres on localhost:5432
cp services/api/.env.example services/api/.env
pnpm --filter @streamingapp/api db:migrate
pnpm --filter @streamingapp/api db:seed
pnpm --filter @streamingapp/api dev  # http://localhost:3000, OpenAPI at /docs
pnpm --filter @streamingapp/admin-web dev   # http://localhost:3001
pnpm --filter @streamingapp/web dev         # http://localhost:3002
```

See [`docs/operations/local-dev.md`](docs/operations/local-dev.md) for the mobile app, environment
variables and the fake media/billing providers used in development.

## Security model in one paragraph

The mobile app never decides whether someone may watch. The backend verifies purchases with Apple or
Google, keeps one normalized entitlement per user, and issues short-lived playback authorizations
after checking the account, content region, entitlement, device and concurrent-stream limits. Video
is delivered from the media provider with signed, expiring URLs and (in production) Widevine/FairPlay
DRM. See [`docs/security/threat-model.md`](docs/security/threat-model.md).
