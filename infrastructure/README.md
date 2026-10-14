# Infrastructure

What exists today and what the hosted environments will look like. Deployment automation (infrastructure
as code and CI/CD pipelines) is **still to come**; until then this file records the intended setup.

## What is here now

- `database/init/`: SQL run by the local PostgreSQL container on its first start (creates the
  `streaming_test` database for end-to-end tests). Used by `docker-compose.yml` at the repository root.

Local development is covered in [`docs/operations/local-dev.md`](../docs/operations/local-dev.md).

## Environments

| Environment | Purpose | Providers |
|---|---|---|
| Development | Each developer's machine: Docker PostgreSQL, test accounts, sample videos | Fake media and fake billing (`MEDIA_PROVIDER=fake`, `BILLING_MODE=fake`) |
| Staging | Production-like configuration with test content; store sandbox purchases | Real AWS media pipeline and DRM vendor (test keys), Apple and Google sandbox |
| Production | Real subscribers, billing and published content | Real providers only; the API refuses to start with fake providers when `NODE_ENV=production` |

Each environment has its own database, storage buckets, CDN distribution, secrets and store or DRM
credentials. Nothing is shared between them, and production credentials are never used in development
builds.

## Secrets

- Staging and production secrets live in a cloud secret manager (for example AWS Secrets Manager) and
  are injected into the API and admin dashboard at runtime.
- The runtime identity of each service can read only its own secrets.
- No secret is committed to git, baked into a container image, or shipped in the mobile app.
- Rotation rules are in the [threat model](../docs/security/threat-model.md#8-secret-handling-and-rotation).

## Database

- Managed PostgreSQL 16 in a private network, TLS required.
- Automated daily backups with point-in-time recovery; a restore is tested before launch and
  periodically afterwards.
- Separate accounts: a migration account used only by the deployment step, and a least-privilege
  runtime account for the API.
- Migrations run as a deployment step before the new API version receives traffic.

## Media and CDN

- Private S3 buckets for master uploads and packaged output, with public access blocked.
- AWS Elemental MediaConvert jobs package encrypted HLS/DASH, obtaining content keys from the
  multi-DRM vendor (SPEKE).
- CloudFront in front of the packaged output, using origin access control so the S3 origin is never
  reachable directly. Playback requires signed URLs or cookies issued by the API; the signing private
  key is kept in the secret manager.
- The API itself sits behind CloudFront (or another edge that overwrites the viewer-country header),
  and its origin accepts traffic only from that edge, so `TRUSTED_COUNTRY_HEADER` cannot be spoofed.

## Still to come

- Infrastructure as code for staging and production.
- CI/CD (GitHub Actions): lint, type-check, tests, OpenAPI drift check, container build, migrations and
  deploy with review before production.
- Monitoring and alerting: API errors, playback denials by error code, webhook failures, database
  health and CDN and DRM usage against budget.
