# RunSphere — Project Architecture (verified)

> Written 2026-11-20 from a read-only inspection of commit `92bbee6` ("Deployment ready v1").
> Everything here was checked against the code, not the docs. Where `docs/` disagrees with the
> code, the code is described and the disagreement is listed in [§9](#9-where-docs-and-code-disagree).

## 1. What the product is

An Android-first (Expo / React Native) **running** app for the Mumbai Metropolitan Region. Runs are
recorded offline on the device, uploaded in checksummed chunks, validated and privacy-trimmed
server-side, and then feed social and gamified features: **Turf** (closed-loop territory claims on
an H3 grid with monthly seasons), friends, challenges, clubs, competitions, leaderboards, quests,
route suggestions, safety sharing, moderation, and an admin console.

## 2. Repository layout

pnpm 10 workspace + Turbo 2. Node 22 (CI: 22.21.0). TypeScript 6, ESM everywhere.

| Path                                  | Package                    | Role                                                                                                                                                                                                                                                                        | Size (approx.)                |
| ------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `apps/mobile`                         | `@runsphere/mobile`        | Expo 57 / RN 0.86 (New Arch) Android client. MapLibre RN, SQLCipher (expo-sqlite), SecureStore, expo-location, biometric run verification, background fetch. Committed `android/` and `ios/` native projects.                                                               | ~110 src files, 67 test files |
| `apps/admin`                          | `@runsphere/admin`         | Vite + React 19 staff console. Single `shell.tsx` (1.2k lines) + `api.ts`.                                                                                                                                                                                                  | small                         |
| `services/api`                        | `@runsphere/api`           | Fastify 5 HTTP API, ~125 routes, TypeBox schemas, OpenAPI via `@fastify/swagger`. Runs migrations on boot.                                                                                                                                                                  | ~30 route/logic files         |
| `services/worker`                     | `@runsphere/worker`        | Single-process polling loop: activity validation, delivery (push/email), scheduled jobs (seasons, boards, competitions, ML features, deletion, retention).                                                                                                                  | ~25 files                     |
| `services/ml`                         | (Python, not in workspace) | FastAPI anti-cheat (`/score`, Isolation Forest) and quest recommender (`/recommend`). Training is CLI scripts. Not deployed anywhere in-repo.                                                                                                                               | small                         |
| `packages/contracts`                  | `@runsphere/contracts`     | TypeBox request/response schemas shared by API, mobile and admin. Also `canonicalJson` + checksum helpers.                                                                                                                                                                  |                               |
| `packages/domain`                     | `@runsphere/domain`        | Pure domain logic: territory claim detection & H3 carving, ghost race, run integrity, run verification, progression, achievements, challenges, clubs, competitions, notifications catalogue, ML features, quest/route recommendation. Only `h3-indexer.ts` imports `h3-js`. | 28 modules, 549 tests         |
| `packages/db`                         | `@runsphere/db`            | `pg` Pool wrapper, `migrate()` (advisory lock + `schema_migrations`), `withTransaction`, PostGIS test gates.                                                                                                                                                                |                               |
| `packages/config`                     | `@runsphere/config`        | API env parsing (`PORT`, `CORS_ALLOWED_ORIGINS`, `STAFF_REVIEW_ACCOUNT_IDS`, `METRICS_COLLECTOR_TOKEN`) and pino redaction paths.                                                                                                                                           |                               |
| `packages/observability`              | `@runsphere/observability` | Structured logger + Prometheus-style metrics.                                                                                                                                                                                                                               |                               |
| `packages/ui`                         | `@runsphere/ui`            | Semantic colour tokens only.                                                                                                                                                                                                                                                |                               |
| `infra/`                              | —                          | `compose.yaml` (PostGIS 18 + optional Martin, Valhalla, pgAdmin placeholders), `postgres/migrations/*.sql` (45 files, 001–046, `006` absent).                                                                                                                               |                               |
| `scripts/`                            | —                          | `migrate.mjs`, `verify-migrations.mjs` (static CHECK/seed validation), `verify-maplibre-compatibility.mjs`, `data/import-reviewed-quests.mjs`, untracked `seed-admin.mjs`.                                                                                                  |                               |
| `Dockerfile.api`, `Dockerfile.worker` | —                          | Single-stage images built from the workspace.                                                                                                                                                                                                                               |                               |
| `patches/h3-js@4.1.0.patch`           | —                          | Makes h3-js tolerate missing `TextDecoder` encodings.                                                                                                                                                                                                                       |                               |
| `docs/`                               | —                          | Extensive product/ADR docs, partly stale (see §9).                                                                                                                                                                                                                          |                               |
| `test-claim.ts` (root), `scratch/`    | —                          | Debug leftovers. `scratch/` is gitignored; `test-claim.ts` is tracked.                                                                                                                                                                                                      |                               |

## 3. Runtime topology

```text
 Android app (Expo)                     Admin console (Vite SPA)
  ├ SQLCipher activity recorder + queue   └ in-memory bearer token, no refresh
  ├ SecureStore auth tokens
  ├ background-fetch sync task
  └ MapLibre (style URL from env; app-owned fallback)
            │ HTTPS JSON (Bearer access token)
            ▼
 Fastify API  (services/api, port 3001)
  ├ runs all SQL migrations on boot (advisory-locked)
  ├ ~125 routes, TypeBox-validated
  ├ synchronous territory-claim pipeline (H3 carving in-request)
  └ optional call → ML anti-cheat /score (ML_SCORER_URL)
            │
            ▼
 PostgreSQL 18 + PostGIS ◄──── Worker (services/worker), single loop:
  ├ outbox_events (transactional)   processMaintenance() → processNextActivity()
  ├ triggers enqueue email/notif     → processNextChallengeFinish() → processNextDelivery()
  └ 90+ tables                       (FCM push / HTTP email provider when configured)
```

The worker imports `processActivity` directly from `@runsphere/api/activity`, so the worker
depends on the API package at build time.

## 4. Key data flows

### 4.1 Auth

- `POST /v1/auth/register|login` → argon2id password check → `issueSession`:
  - **Access token**: custom `base64url(JSON{sub,exp}).HMAC-SHA256` signed with `AUTH_TOKEN_SECRET`,
    15-minute lifetime, stateless (no revocation lookup).
  - **Refresh token**: `selector.verifier`, 30 days, argon2-hashed in `refresh_tokens`, grouped in
    `refresh_token_families`. Rotation on every refresh; **reuse of a used token revokes the whole
    family**.
- Mobile stores tokens in SecureStore (`auth-storage-core.ts`). `MobileApiClient.request()` retries
  once on 401 by calling `refresh()`. There is no single-flight guard (see BUGS B1).
- The local data partition key on the device is the `sub` claim decoded from the access token
  (`account-scope.ts`).
- Staff authorization uses two mechanisms: `STAFF_REVIEW_ACCOUNT_IDS` env allow-list (activity review
  queue only) and `staff_role_assignments` DB roles (everything else, duplicated helper in 7 route files).

### 4.2 Run recording → validated activity (core loop)

1. **Device**: `activity-recorder-core.ts` writes location samples into SQLCipher SQLite. A run may be
   biometric-verified first (`run-verification*.ts`, migration 046).
2. **Upload** (`activity-sync.ts`): `POST /v1/activities` (Idempotency-Key + request fingerprint) →
   `PUT /v1/activities/:id/chunks` (≤500 points, `X-Chunk-Checksum` = SHA-256 of canonical JSON) →
   `POST /v1/activities/:id/finalize` (aggregate checksum). `GET .../sync?expectedChunkCount=N` reports
   missing sequences for resume. Replays are idempotent (204), conflicts 409.
3. **Finalize** sets status `validating` and writes an `activity.finalized` outbox event.
4. **Worker** `processNextActivity` claims the event (`FOR UPDATE SKIP LOCKED`, 5 attempts, 5-min stale
   reclaim) → `processActivity` (`services/api/src/activity.ts`):
   - drops points within 200 m of the owner's privacy zones (PostGIS `ST_DWithin`),
   - computes distance/duration (accuracy ≤50 m, gaps ≤60 s, speed ≤25 km/h),
   - writes `activity_derivations` (trimmed MultiLineString), `activity_validation_outputs`,
     `activity_validation_runs`, sets status `derived`.
   - It does **not** award XP, complete quests, create claims, or emit follow-on events.
5. Raw chunks are purged after 30 days (`purgeExpiredRawTraces`).

### 4.3 Turf (territory claims) — the primary game mechanic

- **Client-initiated**: on the Map tab, `TurfScreen` offers the most recent `derived` run and calls
  `POST /v1/territory/claims { activityId }`.
- API pipeline (`territory-claim-routes.ts`, 1.9k lines), all synchronous in the request:
  run-integrity gate (`domain/run-integrity.ts`, may refuse) → advisory ML score (never refuses) →
  `ml_run_features` row → `detectLoopClaim` → ghost trace (200 m trimmed each end) → canonicalised ring
  → H3 res-11 cell set → min-area check → privacy-zone refusal → **transaction**: lock overlapping live
  claims (`FOR UPDATE`), `assessCarve` per holder, carve/defend, `largestConnectedComponent`, insert
  claim + takeovers + attempts + events + notifications + geo tags.
- Reads: `/v1/territory/claims` (bbox), `/clusters`, `/recommendations`, `/summary`, `/activity`,
  `/:id/history`, `/:id/ghost-trace` (3/hour), `/v1/territory/leaderboard?scope=individual|club|city|country|global`,
  `/leaderboard/seasons|recap|hall-of-fame`, `/v1/territory/events`.
- Worker jobs: geo-tag backfill → weekly rank snapshot → season-ending warning → monthly reset
  (state-driven, idempotent).
- A second, separate territory system (**H3 cell seasons**, migrations 028–030, `territory-scoring.ts`,
  `territory-season.ts`) is built but switched off via `TERRITORY_CAPTURE_ENABLED = false`.

### 4.4 Notifications and email

- `notification_inbox` is the durable record. DB triggers (014, 039) enqueue `notification.created` and
  `email.transactional` outbox events.
- Worker `processNextDelivery` → `createConfiguredDelivery`: FCM HTTP v1 if `FCM_*` set; HTTP email
  provider if `EMAIL_API_URL/KEY/FROM` + `APP_BASE_URL` set; otherwise logged no-ops.
- Email tokens are rotated by the worker at send time so plaintext tokens are never stored.

### 4.5 Social / gamification

Friends, blocks, profile, inbox and preferences (`gamification-routes.ts`), challenges (+ worker
scoring), clubs / relays / club challenges / club boards (`club-routes.ts`, 1.7k lines), global boards
(worker recompute), competitions (staff-scheduled, worker-advanced), moderation, reports, sanctions
and appeals, campaigns (staff, consented email).

### 4.6 Map

`maps/map-config.ts` accepts a style URL only when its origin is in an allow-list (HTTPS, or local HTTP
in dev). The app uses the free **OpenFreeMap** style, set in `apps/mobile/.env` (the API serves no
map style since 2026-11-21). Without config the app renders an app-owned fallback surface.

## 5. Database

- PostgreSQL 18 + PostGIS 3.6, extensions `postgis`, `pgcrypto`, `uuid-ossp` (`infra/postgres/init`).
- Migrations: plain SQL, applied in filename order by `packages/db migrate()` inside a transaction per
  file, under an advisory lock, on **API boot**, **worker boot**, and `pnpm migrate`. No down-migrations.
  `scripts/verify-migrations.mjs` statically checks seeds against CHECK constraints (passes: 45 files).
- Main table groups (by migration):

| Range             | Domain                                      | Key tables                                                                                                                                                                                                                                                                                                                                |
| ----------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 001–004           | Accounts and activity ingestion             | `accounts`, `refresh_token_families`, `refresh_tokens`, `privacy_zones`, `activity_submissions`, `activity_chunks`, `activity_derivations`, `outbox_events`                                                                                                                                                                               |
| 005, 007, 009–013 | Staff audit, privacy and safety, governance | `staff_audit_events`, `safety_contacts`, `safety_share_sessions/updates`, `privacy_audit_events`, `account_deletion_tombstones`, `raw_trace_objects`, `email_verification_tokens`, `password_reset_tokens`, `email_change_requests`                                                                                                       |
| 008               | Quests and goals                            | `curated_places`, `curated_checkpoints`, `quest_versions`, `quest_version_checkpoints`, `weekly_activity_goals`, `activity_validation_outputs`                                                                                                                                                                                            |
| 011, 014–027      | Gamification                                | `profiles`, `friendships`, `blocks`, `notification_inbox/preferences`, `rule_versions`, `legal_versions`, `staff_roles`, `xp_entries`, `achievement_*`, `challenges`, `leaderboard_opt_ins`, `push_devices`, `clubs`, `club_relays`, `club_challenges`, `global_board_entries`, `competitions`, `reports`, `sanctions`, `email_campaigns` |
| 028–030           | H3 cell seasons (disabled)                  | `territory_seasons`, `territory_cell_contributions`, `territory_week_state`, …                                                                                                                                                                                                                                                            |
| 031–038, 043      | Turf                                        | `territory_claims` (H3 `text[]` + GIN, `season_month`, geo tags), `territory_claim_takeovers`, `run_integrity_flags`, `territory_trade_flags`, `territory_events`, `territory_claim_attempts`, `territory_claim_seasons`, `territory_claim_hall_of_fame`, `territory_geo_cells`, `territory_claim_ghost_traces/views`                     |
| 039–042           | Delivery and catalogue                      | `email_dispatches`, `email_provider_events`, `curated_routes` (empty), `route_suggestion_events`                                                                                                                                                                                                                                          |
| 044–046           | ML and verification                         | `ml_run_features`, `ml_models`, `quest_acceptances`, `quest_completions` (no writers), verification columns on `activity_submissions`                                                                                                                                                                                                     |

## 6. Build, test and CI

_Updated 2026-11-20 after Milestone 0._

- `pnpm typecheck`: passes (17/17 tasks).
- `pnpm lint`: passes (0 errors).
- `pnpm test`: 2,082 pass with the PostGIS gate open and 0 skipped. Without the gate, 139 integration
  tests skip. Run them against an isolated `runsphere_test` database (see `CLAUDE.md`).
- CI (`.github/workflows/ci.yml`): format check → infra config test → PostGIS check → MapLibre check
  → static migration check → lint → typecheck → build → migrate → test (PostGIS integration enforced
  via `requirePostgisInCi`). Every step passes locally with `CI=true`. The first GitHub run of this
  is the M0 PR.
- Local `format:check` reports 348 files only because this Windows checkout has CRLF working-tree files
  (blobs are LF, `.gitattributes` pins `eol=lf`). CI on Linux is unaffected.

## 7. Deployment state

- `Dockerfile.api` and `Dockerfile.worker` exist (single-stage, dev deps included, `pnpm install
--frozen-lockfile` with only a subset of workspace packages copied). Neither has been verified to
  build. There is no compose service, manifest or IaC that runs the API, worker or ML service.
- The mobile `eas.json` `development` profile hardcodes a LAN API URL. `preview` and `production` set
  no `EXPO_PUBLIC_API_BASE_URL`, so a production build would start in the "configuration" failure
  state unless it's set as an EAS environment variable.
- No Firebase (`google-services.json`), email provider or ML deployment is configured.

## 8. Cross-cutting conventions in the code

- Server is authoritative for validation, scoring, claims and awards. The client never computes
  awards. One exception exists today: XP is only computed when a client calls
  `/v1/progression/sync`, and no client does (BUGS B2).
- No raw coordinates in logs. Pino redaction paths live in `packages/config`.
- Every route checks `if (!database) return 503`, then `requireAccount()`.
- Pure "model" modules sit next to screens (`screens/*-model.ts`) and carry the unit tests. Render
  tests use `react-test-renderer`, which is deprecated.
- `.native.ts` variants hold platform code. `metro.config.js` has a custom resolver
  (`FORCE_PLAIN_TS`) to stop `.native.ts` shadowing; `h3-js` is stubbed on mobile.
- Comments are long and explanatory, often citing docs and ADRs by name.

## 9. Where docs and code disagree

| Topic            | Docs say                                                                                       | Code does                                                                                                                              |
| ---------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Tabs             | ✅ Resolved 2026-11-20: **Home** is the landing tab; docs updated                              | `navigation/types.ts`: `Home, Map, Run, Social, Profile`, landing = `Home`                                                             |
| Activity types   | `README.md`, `CONTRIBUTING.md`: walk/run/hike                                                  | Running only (DB CHECK, contracts)                                                                                                     |
| API scope        | `docs/architecture.md`: API serves `/health` and `/v1/quests` only                             | ~125 routes                                                                                                                            |
| Pending work     | `docs/pending-work.md` is "single source of truth"                                             | Contains two contradictory copies of sections 1–9. Many "not built" items are built (leaderboard endpoints, ML, route suggestion API). |
| Ghost race limit | "Rate limit of 3/hour enforced at DB level"                                                    | App-level count-then-insert                                                                                                            |
| Account deletion | ✅ Resolved 2026-11-20 by ADR-0012: immediate, verified, complete erasure; copy and code agree | —                                                                                                                                      |
| ML training      | Worker posts to `{ML_TRAINER_URL}/train`                                                       | `services/ml` has no `/train` HTTP endpoint (CLI scripts only)                                                                         |
