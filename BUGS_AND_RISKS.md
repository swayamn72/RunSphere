# RunSphere — Bugs and Risks (verified)

> Written 2026-11-20 from a read-only inspection of commit `92bbee6`. Each item lists the evidence
> and a **confidence** level:
>
> - **Confirmed**: I read the full code path and the defect follows directly.
> - **Likely**: the code strongly suggests it, but it depends on runtime or device behaviour I didn't run.
> - **Unverified**: worth checking. I didn't establish it either way.

Severity: **S1** blocks launch or loses data/security · **S2** a core feature is broken or degraded ·
**S3** correctness or quality · **S4** hygiene.

## 1. Functional bugs

### B1 — ✅ FIXED 2026-11-20 (single-flight refresh, commit f3f0db3) — Users are logged out when several requests hit an expired access token (S1, Confirmed)

- `apps/mobile/src/api-client.ts` `request()`: on 401 each in-flight request calls `this.refresh()`
  independently. There is no single-flight lock.
- `services/api/src/auth.ts` `rotateSession()`: the second use of the same refresh token finds
  `used_at` already set and **revokes the whole family**, which kills the new token the first refresh
  just issued.
- Trigger: any screen that loads in parallel after the access token's 15-minute lifetime. `TurfScreen`
  fires 5 requests via `Promise.all`; FriendsScreen, NotificationsScreen and ClubsScreen also fire
  parallel requests.
- Fix: a shared in-flight refresh promise in the client, and optionally a short server-side grace
  window for the immediately previous token.

### B2 — ✅ FIXED 2026-11-20 (worker week-close job; see correction below) — XP, levels and weekly consistency are never awarded (S2, Confirmed)

> **Correction (2026-11-20):** the current week's XP did show, as a live projection. What never
> happened was persisting _closed_ weeks, so XP and level fell back every Monday. Fixed by a
> state-driven worker job (`progression_week_close`, migration 047) sharing one implementation with
> `POST /v1/progression/sync`, rather than a per-activity event.

- XP is written only by `POST /v1/progression/sync` (`progression-routes.ts`).
- No mobile code calls `syncProgression()` (`HomeScreen.tsx` explicitly avoids it), and the worker has
  no progression step after `processActivity`.
- Result: every account shows level 1 and 0 XP however much it runs.
- Fix: award progression server-side when an activity becomes `derived`, via an outbox event the
  worker consumes. The award is already idempotent through `xp_entries.dedupe_key`.

### B3 — ✅ FIXED 2026-11-20 (isolated jobs, queues drained independently) — The worker loop starves activity processing and has head-of-line failure (S1, Confirmed)

- `services/worker/src/worker.ts` `runWorker()` runs the full `processMaintenance()` (17 jobs,
  including the global-board full recompute) **before every single activity**, then processes at most
  one activity, one challenge and one delivery.
- If any maintenance job throws (geocode, ML feature extraction, campaign), the iteration aborts and
  **no activity is processed at all** until that job stops throwing.
- Fix: separate the queues from the scheduled jobs. Drain the activity and delivery queues in their
  own loop, run maintenance on a timer, and isolate each job with its own try/catch.

### B4 — ✅ FIXED 2026-11-20 (migration 048 + per-run lock + app filter) — The same run can be claimed for territory repeatedly (S2, Confirmed)

- `territory_claims.activity_id` has no unique constraint (migration 031), and
  `POST /v1/territory/claims` doesn't check for an existing claim from that activity.
- `TurfScreen.tsx:173` always offers the most recent `derived` run, even after it has been claimed.
- Effect: repeated self-carving, inflated `capture_count`, events and notifications, and noisy
  leaderboards and history.
- Fix: unique partial index on `(activity_id)`, plus an idempotent "already claimed" result.

### B5 — Two simultaneous claims on empty ground both succeed (S3, Likely)

> **Still open.** M2's per-run lock serialises two submissions of the _same_ run; two _different_
> runs on the same empty ground can still both claim.

- The claim transaction serialises only through `SELECT … FOR UPDATE` on _existing_ overlapping
  claims. With none, two concurrent requests both insert overlapping claims.
- Fix: a transaction-level advisory lock keyed on the coarse H3 parent cells (e.g. res 6), or
  SERIALIZABLE isolation with retry.

### B6 — ✅ FIXED 2026-11-20 (ADR-0012): password required, all sessions revoked, login refused while erasure is pending, email copy corrected, Play-required web pages added, address-keyed rows erased. Original finding below.

### B6 (original) — Account deletion is immediate and contradicts its own copy (S1, Confirmed)

- `DELETE /v1/account` (the endpoint mobile uses) sets `deletion_requested_at`, and the worker's
  `convergeAccountDeletion` hard-deletes on the **next sweep** (seconds).
- The `deletion_verify` email says "Deletion begins after a 30-day waiting period, and signing in to
  RunSphere cancels it". Neither is implemented, and login doesn't look at `deletion_requested_at`.
- No re-authentication is required, so a stolen access token is enough to erase an account.
- Fix: decide the policy (product and legal), add `deletion_scheduled_for`, cancel on sign-in, and
  require a password or recent auth.

### B7 — Email action links lead nowhere (S1, Confirmed)

- `services/worker/src/email-delivery.ts` builds links to `/verify-email`, `/reset-password`,
  `/confirm-email-change` and `/confirm-deletion` under `APP_BASE_URL`. No web app, admin route or
  mobile deep link handles them.
- Consequences: email can never be verified, so **safety contacts and shares can't be used** (both
  sides need `email_verified_at` and `trust_established_at`). Password reset and email change also
  can't complete.
- Fix: a minimal web page (or Android App Links / deep links) that POSTs the token to the existing
  `/complete` endpoints.

### B8 — ✅ FIXED 2026-11-20 — A run with zero points stays in `validating` forever (S3, Confirmed)

- `services/api/src/activity.ts` `processActivity`: `if (points.length === 0) return;` exits without a
  status change, and the worker then marks the outbox event processed.
- Fix: transition to `rejected` with reason `no_points`.

### B9 — ✅ FIXED 2026-11-20 — Activity processing is not transactional (S3, Confirmed)

- Four separate writes. `activity_validation_runs` has no `ON CONFLICT`, so a retry after a partial
  failure duplicates rows. A crash between writes leaves derivations without a status change.
- Fix: wrap `processActivity` in `withTransaction`.

### B10 — ✅ FIXED 2026-11-20 — The weekly goal week uses UTC, not Asia/Kolkata (S3, Confirmed)

- `quest-routes.ts weeklyGoalResponse` uses `date_trunc('week', now())`. ADR-0006 mandates
  Asia/Kolkata weeks, and other modules (progression, territory ranks) use Kolkata. Runs between
  Sunday 18:30 and 24:00 UTC count toward the wrong week.

### B11 — ✅ FIXED 2026-11-20 — The Ghost Race limit can be exceeded (S4, Confirmed)

- `territory-claim-routes.ts` counts views and then inserts in a separate statement. Concurrent
  requests exceed 3/hour. The docs claim DB-level enforcement.

### B12 — ⏸ DEFERRED (ADR-0013: no ML at launch) — The ML retrain job targets an endpoint that doesn't exist (S3, Confirmed)

- `ml-retrain-job.ts` POSTs `{ML_TRAINER_URL}/train`. `services/ml` exposes only `/health`, `/score`
  and `/recommend`; training is `python train.py`.

### B13 — ✅ FIXED 2026-11-20 — The Android permission verifier failed on Windows (S4)

- `apps/mobile/src/verify-android-permissions.mjs` passed `URL.pathname` (`/C:/...`) to `aapt` and
  crashed when a debug APK existed without `aapt` on PATH. It now uses `fileURLToPath`, looks for
  `aapt.exe`, and reports and skips the APK check when `aapt` is missing
  (`REQUIRE_APK_PERMISSION_CHECK=1` makes it fatal).

### B14 — ✅ FIXED 2026-11-20 — Lint and formatting kept CI red (S3)

- 92 ESLint errors (dead imports in `services/api/src/app.ts`, `require()`/`any` in mobile, one unused
  domain const) and 32 genuinely unformatted files (CI's first step is `format:check`). Both are now
  clean, so CI reaches typecheck, build, migrate and the PostGIS suites.

### B15 — The production mobile build has no API URL (S1 for release, Likely)

- `eas.json` `production` and `preview` define no `EXPO_PUBLIC_API_BASE_URL`. Unless it's set in the
  EAS dashboard, the app starts in the `configuration` failure state. `development` hardcodes a LAN IP.

### B16 — Docs disagree with the code on navigation and scope (S4, Confirmed)

- See PROJECT_ARCHITECTURE.md §9. Landing tab ✅ resolved 2026-11-20: **Home** (docs updated to
  match the code). Other drift remains.

### B17 — ✅ FIXED 2026-11-20 — Activity detail never returned run verification (S3)

- `GET /v1/activities/:activityId` didn't select the verification columns, so a verified run came
  back with no `verification`. It now selects them via `qualifiedVerificationColumns('submission')`.
- Correction to the first report: only **1** of the 4 failing "run verification" tests was this bug.
  The other 3 were a test-harness issue. The suite registers more than 10 accounts a minute from one
  inject address, and the (correct) registration rate limit answered 429. Each test account now uses
  its own `remoteAddress`.

### B18 — ✅ FIXED 2026-11-20 — Weekly-peak test expired with the calendar (S4, not a product bug)

- Correction to the first report: `territory-rank-job.ts` was correct. The test inserted claims into
  the _current_ season but ran the job with hardcoded September 2026 dates, so it has failed every
  day since 1 October. It now uses the 8th and 15th of the current season.

### Integration run (2026-11-20, isolated `runsphere_test` database, `CI=true`)

All migrations apply cleanly. **Every PostGIS suite passes with nothing skipped**: API 568/568,
worker 195/195 (including the new account-deletion suite). A mobile test (`api-config`) was also
made independent of an exported `EXPO_PUBLIC_API_BASE_URL`, which had made it fail in shells that
load `.env`.

## 2. Security risks

| ID  | Risk                                                                                                                                                                                                                                                                                                            | Severity      | Confidence | Evidence / note                                                      |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ---------- | -------------------------------------------------------------------- |
| R1  | ✅ FIXED 2026-11-20. `scripts/seed-admin.mjs` used to hardcode an admin password and a personal email. It now reads everything from `SEED_ADMIN_*` env vars, refuses `NODE_ENV=production` without `SEED_ALLOW_PRODUCTION=true`, never resets an existing password unless asked, and masks addresses in output. | —             | —          | `pnpm seed:admin`                                                    |
| R2  | ⏸ DEFERRED (ADR-0013); must be fixed before `ML_SCORER_URL` is set. ML `/score` and `/recommend` have no authentication, though the API sends `ML_SCORER_TOKEN`                                                                                                                                                 | S2 if exposed | Confirmed  | `services/ml/src/*/server.py`                                        |
| R3  | Access tokens can't be revoked: valid up to 15 min after logout, suspension or deletion. `requireAccount` never checks the account state.                                                                                                                                                                       | S3            | Confirmed  | Acceptable with short TTLs. Sanctions are rechecked at refresh only. |
| R4  | ✅ FIXED 2026-11-20. Auth rate limiting is in-memory and per-process. No `trustProxy`, so behind a load balancer every client shares one IP and registration is capped at 10/min **globally**.                                                                                                                  | S2 at deploy  | Likely     | `auth-routes.ts allowAuthAttempt`, `app.ts` Fastify options          |
| R5  | No general rate limiting on expensive endpoints (claims run H3 + PostGIS synchronously, leaderboards, clusters)                                                                                                                                                                                                 | S2            | Confirmed  | No `@fastify/rate-limit`                                             |
| R6  | ✅ FIXED 2026-11-20. Login timing allows user enumeration: no dummy argon2 verify when the email is unknown                                                                                                                                                                                                     | S4            | Confirmed  | `auth-routes.ts /v1/auth/login`                                      |
| R7  | `GET /satellite.json` publishes an Esri World Imagery style. Production use requires an Esri licence and contradicts the "approved provider only" map policy.                                                                                                                                                   | S2 (legal)    | Confirmed  | `services/api/src/app.ts`                                            |
| R8  | ✅ FIXED 2026-11-20. `DELETE /v1/account` now requires the current password (ADR-0012).                                                                                                                                                                                                                         | —             | —          |                                                                      |
| R9  | Docker images are single-stage, run as root, and ship dev dependencies and full sources                                                                                                                                                                                                                         | S3            | Confirmed  | `Dockerfile.api`, `Dockerfile.worker`                                |
| R10 | Migrations run automatically on **every API and worker boot**, with no down-migrations. A bad migration takes both down, and API replicas race on the advisory lock.                                                                                                                                            | S3            | Confirmed  | `server.ts`, `worker.ts`                                             |
| R11 | ✅ FIXED 2026-11-20 (refresh in `apps/admin/src/api.ts`). Admin keeps the bearer token in React state, with no refresh and no CSRF concern (bearer only). Fine for security, poor for usability.                                                                                                                | S4            | Confirmed  | `apps/admin/src/shell.tsx`                                           |
| R12 | Untracked `.npmrc` sets a Windows-only `virtual-store-dir=C:\pnpm-vs`. Committing it would break Linux CI and Docker installs.                                                                                                                                                                                  | S3            | Confirmed  | Keep it local, or move it to the user-level npmrc                    |
| R13 | Untracked `apps/mobile/src/fixtures/*.ndjson` contains GPS coordinates (synthetic), and CONTRIBUTING forbids traces in fixtures. Check it's synthetic before committing.                                                                                                                                        | S4            | Confirmed  |                                                                      |
| R14 | Background sync task runs headless. SQLCipher key retrieval and DB initialization outside the React tree are unverified.                                                                                                                                                                                        | S3            | Unverified | `App.tsx` `TaskManager.defineTask`                                   |

Positive findings: argon2id passwords; hashed refresh tokens with reuse detection; email tokens rotated
at send time and never stored in plaintext; parameterised SQL throughout (no string-built SQL with user
input seen); pino redaction of tokens, emails and coordinates; CORS allow-list; owner-scoped activity
reads; privacy-zone trimming on the server; safety-share reads gated on verified, accepted contacts.

## 3. Architectural issues

1. **One worker loop does everything** (B3). There's no job scheduler, no per-job cadence and no
   isolation. Throughput is one activity per maintenance sweep.
2. **The worker depends on the API package** (`@runsphere/api/activity`). Activity validation logic
   lives in the API package and is imported by the worker, which couples their builds and releases.
   It belongs in `packages/domain` or a shared `packages/pipeline`.
3. **Side effects of a finished activity are scattered and client-triggered**: XP via a client sync
   that never happens, achievements via a screen visit, claims via a button. There's no
   `activity.derived` fan-out despite the outbox design in `docs/architecture.md`.
4. **Very large route files** (`territory-claim-routes.ts` 1.9k lines, `club-routes.ts` 1.7k,
   `territory-board-routes.ts` 1.1k) mix SQL, policy and HTTP. The staff-role lookup is copy-pasted in
   7 files.
5. **Two staff authorization models** (env allow-list vs DB roles).
6. **Two territory engines** (Turf live, H3 seasons dormant) with separate tables and jobs. Every
   sweep pays for the dormant one's checks, and readers get confused.
7. **Documentation drift**: `pending-work.md` contains two contradictory versions, and architecture
   and README describe a much earlier state. Agents following the docs will do wrong work.
8. **No deployment path**: no runtime manifest for the API, worker, Postgres or ML, and no secrets
   management, backups or migration strategy beyond auto-migrate.
9. **Mobile render tests use the deprecated `react-test-renderer`**. There are no device or E2E
   tests (Detox or Maestro).

## 4. Test coverage gaps

| Gap                                                                                                                                       | Why it matters                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| ✅ Closed 2026-11-20: PostGIS suites now run and pass locally against `runsphere_test`, and CI reaches them now that lint and format pass | —                                                              |
| No test for concurrent refresh (B1)                                                                                                       | A production-visible logout bug                                |
| No worker-loop test for "a maintenance failure blocks activity processing"                                                                | B3                                                             |
| No test that a derived activity produces XP                                                                                               | B2                                                             |
| No uniqueness test for claiming the same activity twice                                                                                   | B4                                                             |
| No test for zero-point activity processing                                                                                                | B8                                                             |
| Weekly-goal timezone boundary not tested                                                                                                  | B10                                                            |
| `services/ml` (Python) has zero tests                                                                                                     | Anti-cheat scoring contract is untested                        |
| No E2E or device test of record → upload → derive → claim                                                                                 | The core loop has never been verified automatically end to end |
| Admin: 2 test files for a 1.2k-line shell                                                                                                 | Staff actions are largely untested                             |
| No load or perf test of the claim pipeline (synchronous H3 + PostGIS)                                                                     | Cost and latency budget (₹3,000/month)                         |
| Dockerfiles never built in CI                                                                                                             | Deploy breakage is undetected                                  |
