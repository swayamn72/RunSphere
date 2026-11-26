# Deploying to Railway

Written 2026-11-26 for the first production deploy (Play closed test). One Railway project, three
services: **Postgres** (PostGIS image), **api** and **worker** (this repo's Dockerfiles). Config as
code lives in `infra/railway/*.json`; everything else is set in the Railway dashboard.

Railway's free trial ($5, 30 days) is enough to set this up. The API and worker must stay on, so
move to the Hobby plan before the closed test starts.

## 1. Postgres

1. New project → **Deploy a Docker image** → `postgis/postgis:18-3.6`. Rename the service to
   `Postgres` (the variable references below use that name).
2. Settings → Region: Southeast Asia (Singapore), the closest to Mumbai. Use the same region for
   all three services.
3. Add a **volume** mounted at `/var/lib/postgresql` (PostgreSQL 18 keeps its data under it).
4. Variables:

   | Name                | Value                          |
   | ------------------- | ------------------------------ |
   | `POSTGRES_USER`     | `turfr`                        |
   | `POSTGRES_PASSWORD` | a generated secret (see below) |
   | `POSTGRES_DB`       | `turfr`                        |

5. Don't give it a public domain. The api and worker reach it over Railway's private network.

The migrations create the `postgis`, `pgcrypto` and `uuid-ossp` extensions themselves (002).

## 2. api

1. New service → **GitHub repo** → this repository, branch `main`.
2. Settings → **Config-as-code file**: `infra/railway/api.json`. It builds `Dockerfile.api`, runs
   the migrate job (`migrate-cli`, M4.2) before each deploy, and only switches traffic once
   `/ready` answers, so a failed migration or an unreachable database never goes live.
3. Settings → Networking → **Generate domain** (or add `api.<your-domain>`). This is the
   `EXPO_PUBLIC_API_BASE_URL` for the release build.
4. Variables:

   | Name                      | Value                                                                                                                                          |
   | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
   | `DATABASE_URL`            | `postgresql://${{Postgres.POSTGRES_USER}}:${{Postgres.POSTGRES_PASSWORD}}@${{Postgres.RAILWAY_PRIVATE_DOMAIN}}:5432/${{Postgres.POSTGRES_DB}}` |
   | `AUTH_TOKEN_SECRET`       | a generated secret, at least 32 characters                                                                                                     |
   | `TRUST_PROXY`             | `1` (one proxy, Railway's edge, sits in front; rate limits then see the runner's real IP)                                                      |
   | `LEGAL_OPERATOR_NAME`     | the operator's name                                                                                                                            |
   | `GRIEVANCE_OFFICER_NAME`  | the grievance officer's name                                                                                                                   |
   | `GRIEVANCE_OFFICER_EMAIL` | a monitored address                                                                                                                            |
   | `LEGAL_HOSTING_PROVIDER`  | `Railway`                                                                                                                                      |
   | `LEGAL_EMAIL_PROVIDER`    | the email provider, once chosen                                                                                                                |
   | `LEGAL_COURTS`            | e.g. `the courts at Mumbai, Maharashtra`                                                                                                       |

   Optional, all-or-nothing groups (unset means a logged no-op): email (`EMAIL_API_URL`,
   `EMAIL_API_KEY`, `EMAIL_FROM`, `APP_BASE_URL` = the api's public URL, `EMAIL_WEBHOOK_SECRET`)
   and push (`FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY`). Web account deletion
   (`/account/delete`) and email verification need the email group.

`NODE_ENV=production`, `HOST` and the start command come from the image. Railway sets `PORT`.

## 3. worker

1. New service → the same GitHub repo and branch.
2. Config-as-code file: `infra/railway/worker.json`. No domain: it only polls Postgres.
3. Variables: the same `DATABASE_URL` reference, plus the email and push groups if the api has
   them (the worker sends the email and push notifications).

The worker never migrates. If it starts before the api's first deploy has migrated, it refuses to
start and Railway restarts it until the schema is current.

## Generating secrets

Run locally, once per secret, and paste the output straight into Railway. Use different values for
`POSTGRES_PASSWORD` and `AUTH_TOKEN_SECRET`, and never commit them.

```sh
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

## Check it

```sh
curl https://<api-domain>/health    # {"status":"ok","service":"api",...}
curl https://<api-domain>/ready     # {"status":"ready","service":"api"}: the database answers
```

The api and worker also check at start that no migration is pending (`prepareSchema`), so a
running service always has the schema it was built for.

Then open `https://<api-domain>/privacy` and check no "to be named" is left.

## Backups

Railway volumes aren't backed up for you. Until a scheduled backup job exists, take a dump before
every risky change and at least weekly:

```sh
railway connect Postgres   # or: pg_dump with the TCP proxy URL from the Postgres service
pg_dump --format=custom --file=turfr-$(date +%F).dump "$DATABASE_URL"
```

## The release build

Set these on the EAS `production` environment (`apps/mobile/DEVELOPMENT.md`), then build:
`EXPO_PUBLIC_API_BASE_URL` (the api domain), `EXPO_PUBLIC_MAP_STYLE_URL`,
`EXPO_PUBLIC_MAP_STYLE_ORIGINS`, `EXPO_PUBLIC_MAP_ATTRIBUTION` (see `apps/mobile/.env.example`).
Never set `EXPO_PUBLIC_SYNTHETIC_LOCATION` there.
