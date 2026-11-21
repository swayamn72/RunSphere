# CLAUDE.md — RunSphere

Guidance for Claude Code in this repository. Verified against the code on 2026-11-21 (commit `2a93032`).
Deeper references: `PROJECT_ARCHITECTURE.md`, `IMPLEMENTATION_STATUS.md`, `BUGS_AND_RISKS.md`,
`IMPLEMENTATION_ROADMAP.md` (✅ done / 🟡 partial / unmarked = open; start here to pick work). **Trust the code over `docs/`**: several docs are stale (see
PROJECT_ARCHITECTURE.md §9). In particular, `docs/pending-work.md` is superseded and contradicts itself; ignore it.

## What this is

A running-only (no walk or hike), Android-first Expo app for Mumbai, with a Fastify API, a polling
worker, PostgreSQL 18 + PostGIS, an optional Python ML service, and a Vite admin console. The core loop
is: record a run offline (SQLCipher) → chunked checksummed upload → worker validates and privacy-trims
→ derived activity → social and game features, with **Turf** H3 territory claims as the headline.

## Layout

- `apps/mobile`: Expo 57 / RN 0.86. Entry `App.tsx`; code in `src/`. Screens in `src/screens/*.tsx`
  with pure logic in `*-model.ts`. `.native.ts` holds platform implementations.
- `apps/admin`: Vite + React staff console (`src/shell.tsx`, `src/api.ts`, `src/areas.ts`).
- `services/api`: Fastify. `src/app.ts` registers `*-routes.ts` modules; `src/server.ts` prepares the schema, then listens.
- `services/worker`: `src/worker.ts` main loop (`runWorker`), with one job per file.
- `services/ml`: Python FastAPI (`anticheat/server.py`, `recommend/server.py`). Not part of the pnpm workspace.
- `packages/contracts` (TypeBox schemas), `packages/domain` (pure logic), `packages/db` (pg, migrate,
  withTransaction), `packages/config`, `packages/observability`, `packages/ui` (tokens).
- `infra/postgres/migrations/NNN_name.sql`: forward-only SQL migrations, applied by
  `packages/db migrate()`. Local dev migrates on boot; with `NODE_ENV=production` services only
  check and refuse to start on pending migrations (run `migrate-cli` first, M4.2).
  `infra/compose.yaml` runs local PostGIS.

## Commands

```sh
pnpm install --frozen-lockfile
pnpm typecheck                 # all packages (passes)
pnpm lint                      # passes; keep it at 0 errors
pnpm test                      # unit tests; PostGIS suites skip without the gate
pnpm build
pnpm format:check              # noisy on a CRLF Windows checkout; use the line below there
npx prettier --check --end-of-line auto .   # what CI's format check sees

# single package / single file
pnpm --filter @runsphere/api test
pnpm --filter @runsphere/api exec vitest run src/activity.test.ts
pnpm --filter @runsphere/mobile exec vitest run src/api-client.test.ts

# local database + integration tests
make infra-up                                  # needs .env with POSTGRES_PASSWORD (Make + Docker)
# Use a separate test database, never the dev one (tests create and delete accounts/claims):
#   docker exec runsphere-postgres-1 psql -U <user> -d postgres -c "CREATE DATABASE runsphere_test"
#   then CREATE EXTENSION postgis, pgcrypto, "uuid-ossp" in runsphere_test
DATABASE_URL=postgresql://<user>:<pw>@127.0.0.1:<port>/runsphere_test RUN_POSTGIS_INTEGRATION=1 \
  sh -c 'pnpm build && pnpm migrate && pnpm turbo run test --concurrency=1'   # serial, as CI
# Don't source the root .env into a test shell without unsetting EXPO_PUBLIC_* if you touch
# mobile env-dependent tests.

# run services
pnpm dev:api                                   # tsx watch, loads ../../.env, port 3001
pnpm --filter @runsphere/worker dev            # WORKER_ONCE=true for one sweep
pnpm dev:admin
pnpm dev:mobile                                # Expo; app config in apps/mobile/app.config.ts
pnpm --filter @runsphere/mobile android:assemble:debug

# static checks used by CI
pnpm verify:migrations
pnpm verify:maplibre
```

Mobile `pnpm test` also runs `src/verify-android-permissions.mjs`, which fails on Windows when a debug
APK exists and `aapt` isn't on PATH. Run `vitest run` directly to test only the JS.

## Conventions

- **The server is authoritative** for validation, distance, privacy trimming, XP, claims and awards.
  Never compute rewards on the client.
- **No raw coordinates in logs, analytics, fixtures or issues.** Pino redaction lives in
  `packages/config` (`pinoRedactionPaths`).
- API route pattern: `if (!database) return reply.code(503)…` → `const accountId = requireAccount(request, reply, authSecret); if (!accountId) return;`
  → parameterised SQL. Validate bodies and responses with TypeBox schemas from `@runsphere/contracts`.
  Add new schemas there, not inline.
- Multi-statement writes go through `withTransaction` from `@runsphere/db`.
- Async side effects go through `outbox_events` (claimed with `FOR UPDATE SKIP LOCKED`, `attempts`,
  `failed_at`) and are processed by the worker. Make consumers idempotent (dedupe keys or `ON CONFLICT`).
- Migrations: add a new `infra/postgres/migrations/NNN_*.sql` (next is `052`). Never edit an applied
  migration. Use `IF NOT EXISTS`; there are no down-migrations, so document rollback in the file header.
  Run `pnpm verify:migrations`.
- Domain logic belongs in `packages/domain` (pure, unit-tested). Only `h3-indexer.ts` may import `h3-js`.
  Mobile stubs `h3-js` (`src/shims/h3-js.js`), so never call H3 from mobile code.
- Mobile: keep logic in `*-model.ts` with unit tests. Screens take `api: MobileApiClient` as a prop. If
  you add a `.native.ts` module that is also imported by bare name, register it in
  `metro.config.js` `FORCE_PLAIN_TS`.
- Navigation: tabs and the landing tab are defined once in `apps/mobile/src/navigation/types.ts`:
  `Home, Map, Run, Social, Profile`, landing **`Home`** (product decision 2026-11-20; Turf lives in Map).
- Account deletion follows ADR-0012: password-verified, all sessions revoked, erased within minutes,
  no grace period. Web path at `/account/delete`. Don't reintroduce a waiting period or a
  sign-in-cancels flow without a new ADR.
- Running only: `movement_type = 'run'` is enforced by DB CHECK and contracts.
- Time: weekly periods are Asia/Kolkata (ADR-0006). Turf seasons are calendar months
  (`season_month` `YYYY-MM`).
- Tests sit beside source as `*.test.ts(x)`. PostGIS suites use `describePostgis` and are gated by
  `RUN_POSTGIS_INTEGRATION` (`packages/db`). CI fails if the gate is closed.
- User-facing copy follows `docs/voice.md` (short, second person, runner words, no system jargon,
  never shaming pace). Check new strings against its checklist.
- Formatting: Prettier (`prettier.config.mjs`). LF line endings (`.gitattributes`).
- Comments in this codebase are long and cite docs and ADRs. Match the surrounding style, but keep new
  comments to the _why_.

## Environment

- Root `.env` (see `.env.example`) is read by the API and worker dev scripts (`--env-file-if-exists=../../.env`).
- Required outside tests: `AUTH_TOKEN_SECRET` (≥32 chars), and `DATABASE_URL` or `POSTGRES_*`.
- Optional and gated (unset means a logged no-op): `FCM_*`, `EMAIL_*` + `APP_BASE_URL`, `ML_SCORER_*`,
  `ML_TRAINER_*`, `METRICS_COLLECTOR_TOKEN`, `STAFF_REVIEW_ACCOUNT_IDS`, `MIGRATE_ON_BOOT`.
- Mobile: `apps/mobile/.env` → `EXPO_PUBLIC_API_BASE_URL` (HTTPS outside local dev),
  `EXPO_PUBLIC_MAP_STYLE_URL|ORIGINS|ATTRIBUTION`, `EXPO_PUBLIC_SYNTHETIC_LOCATION` (dev only).

## Where shared rules live (read these before adding similar code)

- **Rate limits:** `services/api/src/rate-limit.ts`, registered in `app.ts`. Off under `NODE_ENV=test`
  (`buildApp({ rateLimits: true })` to test it).
- **Achievements:** `services/api/src/achievement-core.ts` (`syncAchievements`), shared by the sync route
  and the worker (`processNextActivity` calls it after each run). Exported as `@runsphere/api/achievements`.
- **Progression and week close:** `services/api/src/progression-core.ts` (`@runsphere/api/progression`),
  run by the worker job `progression_week_close`.
- **Claims:** `territory-claim-routes.ts`: one claim per run (migration 048), per-run and per-tile
  advisory locks (`claimLockKeys` in `packages/domain`), and the Ghost Race hourly limit.
- **Mobile copy:** `docs/voice.md`. `apps/mobile/src/voice-copy.test.ts` fails on banned system words
  (server, configured, validated, eligible, …) in any screen string. Show errors with
  `failureMessage(error, fallback)` from `src/failure-copy.ts`, never `error.message` (a test enforces this).
  Rho's lines live in `src/rho-coach.ts` (tone test included).
- **Colours:** core tokens in `packages/ui`; the Turf map/HUD palette in
  `apps/mobile/src/theme/game-world.ts`. `theme.test.ts` fails on any hex literal elsewhere and checks
  AA contrast.
- **Admin areas:** `apps/admin/src/areas.ts` gates each area with the API's own role predicates; new
  areas get their own component file (e.g. `turf-area.tsx`) with a `renderToStaticMarkup` test.

## Local pitfalls (Windows checkout)

- Working-tree files are CRLF. `prettier --write <dir>` rewrites line endings of untouched files: stage
  only real changes (`git add $(git diff --ignore-cr-at-eol --name-only)`) and `git checkout` the rest.
- Bash heredocs piped to `node -` lose backslashes, which breaks regexes. Write scripts to a file first.
- PostGIS tests need Docker Desktop running and container `runsphere-postgres-1` started.
- Integration test helpers: give each registration its own `remoteAddress`, or the register rate
  limit answers 429. Add new integration files to the root `test:integration` script.
- The full serial suite takes about 10 minutes; run single files while iterating.

## Guardrails for agents

- Do not commit `.env`, `google-services.json`, or the untracked `.npmrc` (it's Windows-specific).
  Staff accounts are provisioned with `pnpm seed:admin` using `SEED_ADMIN_*` env vars. Never
  hardcode credentials or personal addresses in scripts.
- Run PostGIS integration tests against a **separate** database (e.g. `runsphere_test` in the same
  container), not your dev database: they create and delete accounts and claims.
- `apps/mobile/android` is committed and **hand-edited**. `expo prebuild` wipes four deliberate edits
  (see `apps/mobile/DEVELOPMENT.md`). Don't run prebuild without reapplying them.
- The H3 cell-season engine is intentionally off (`TERRITORY_CAPTURE_ENABLED = false`). Don't enable it
  without the gates in `docs/release-plan.md`.
- ML is advisory only. It must never refuse a run or claim; only `run-integrity.ts` can. It is
  **deferred at launch** (ADR-0013): keep `ML_SCORER_URL`/`ML_TRAINER_URL` unset and don't spend
  effort on `services/ml` unless asked.
- Before changing product rules, check `docs/adr/`. Supersede an ADR rather than contradict it.
- Workflow the owner expects: branch from `main`, keep commits small and logical, run lint,
  typecheck and the affected tests (PostGIS suites against `runsphere_test` when DB code changes),
  then fast-forward merge to `main` and push. Update the roadmap/BUGS markers in the same commit.
  Keep the Android emulator off unless asked. Ask before deleting remote branches or changing
  who can access staff areas.
