# RunSphere — Implementation Roadmap

> Written 2026-11-20. It is ordered by risk: make the build trustworthy first, then make the core loop
> (record → upload → derive → reward → claim) correct, then make it deployable, then finish features.
> Each task is sized for one small PR, has a clear **done when** check, and can ship on its own.
> IDs like B1 or R4 refer to `BUGS_AND_RISKS.md`.

## Milestone 0 — Green, trustworthy build (recommended first milestone)

Goal: CI is green on `main`, and the PostGIS integration suites run and pass. Every later task
depends on this signal.

| ID   | Task                                                                                                                                                           | Done when                                              |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| M0.1 | Remove unused imports and dead code from `services/api/src/app.ts` and other API files (B14)                                                                   | `pnpm --filter @runsphere/api lint` exits 0            |
| M0.2 | Fix mobile lint: replace `require()` background-fetch loading in `App.tsx` with typed lazy imports or a small `background-sync.native.ts` module; remove `any` | `pnpm --filter @runsphere/mobile lint` exits 0         |
| M0.3 | Fix the domain unused const (`MILLIS_PER_DAY`)                                                                                                                 | `pnpm lint` exits 0                                    |
| M0.4 | Fix `verify-android-permissions.mjs` to use `fileURLToPath` and skip the APK check with a clear message when `aapt` is missing (B13)                           | `pnpm test` exits 0 on Windows without the Android SDK |
| M0.5 | Run the PostGIS suites locally (`make infra-up`, `RUN_POSTGIS_INTEGRATION=1`) and fix any failures                                                             | All 139 previously skipped tests pass locally          |
| M0.6 | Confirm CI is green on a branch, including the `Apply migrations` and `Test` steps                                                                             | The GitHub Actions run is green end to end             |
| M0.7 | Renormalise the local checkout to LF (`git rm --cached -r . && git reset --hard`, after committing or stashing work) so `format:check` reflects reality        | `pnpm format:check` passes locally                     |

## Milestone 1 — Core loop correctness

| ID    | Task                                                                                                                                                                                            | Done when                                                                                                                                        |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| M1.1  | Single-flight token refresh in `MobileApiClient` (one shared promise; concurrent 401s await it) (B1)                                                                                            | New unit test: 5 parallel 401s cause exactly 1 refresh call, and all 5 retries succeed                                                           |
| M1.2  | Server: optional 30-second grace for the immediately previous refresh token, so a lost response doesn't revoke the family                                                                       | Integration test: a replay within the grace returns the same family's current token; a replay after it still revokes                             |
| M1.3  | Make `processActivity` transactional and idempotent (B9)                                                                                                                                        | Integration test: an injected failure mid-process leaves no partial rows, and a retry succeeds                                                   |
| M1.4  | Reject zero-point and too-short runs explicitly (`rejected`, reason code) per docs fact 15 (B8)                                                                                                 | Integration test: an empty activity reaches `rejected` and is not stuck in `validating`                                                          |
| M1.5  | Emit `activity.derived` outbox event at the end of `processActivity`                                                                                                                            | Integration test: one event per derived activity, none on reprocess                                                                              |
| M1.6  | Worker consumer: award progression (XP and weekly consistency) on `activity.derived` (B2)                                                                                                       | Integration test: derive a run, then `GET /v1/progression` shows XP > 0; reprocessing doesn't double-award                                       |
| M1.7  | Worker consumer: evaluate achievements on `activity.derived` (drop the screen-visit dependency)                                                                                                 | Same pattern as M1.6                                                                                                                             |
| M1.8  | Restructure the worker loop: drain queues (activity, challenge, delivery) independently of maintenance; run maintenance jobs on per-job intervals; isolate each job with try/catch and log (B3) | Unit test: a throwing maintenance job doesn't prevent activity processing; with 100 queued activities, all derive without 100 maintenance sweeps |
| M1.9  | Weekly goal uses the Asia/Kolkata week (B10)                                                                                                                                                    | Unit test at the Sunday 18:30 UTC boundary                                                                                                       |
| M1.10 | Move `processActivity` and `validateTrace` out of `services/api` into a shared package so the worker no longer depends on `@runsphere/api`                                                      | `services/worker/package.json` has no `@runsphere/api` dependency; tests pass                                                                    |

## Milestone 2 — Turf integrity

| ID   | Task                                                                                                                                                              | Done when                                                                                                 |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| M2.1 | Migration: unique partial index on `territory_claims(activity_id)` (resolve existing duplicates first); route returns an idempotent `already_claimed` result (B4) | Integration test: second claim of the same run returns `already_claimed`, and no new rows appear          |
| M2.2 | Mobile: offer only unclaimed derived runs (needs a `claimed` flag on activity list or claim summary)                                                              | Render test: the claim button is hidden after a successful claim                                          |
| M2.3 | Serialise claims on empty ground with an advisory lock on coarse H3 parents (B5)                                                                                  | Integration test: two concurrent claims on the same empty area produce one claim plus one carve or defend |
| M2.4 | Atomic Ghost Race limit (an `INSERT … SELECT … WHERE count < 3` or a locked counter) (B11)                                                                        | Integration test: 5 concurrent requests produce exactly 3 successes                                       |
| M2.5 | Mobile: season recap / reset card using the existing `getTerritorySeasonRecap`                                                                                    | Render test plus a manual check on an emulator                                                            |
| M2.6 | Mobile: hall of fame and seasons list (existing client methods)                                                                                                   | Render tests                                                                                              |
| M2.7 | Admin: trade-flag review, concentration and events screens for the existing staff routes                                                                          | Admin tests cover each staff action                                                                       |

## Milestone 3 — Accounts, email and safety actually work

| ID    | Task                                                                                                                                                                                                                                       | Done when                                                                      |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| M3.1  | ✅ DONE 2026-11-20. Deletion policy decided: immediate, verified, complete (ADR-0012)                                                                                                                                                      | —                                                                              |
| M3.2  | ✅ DONE 2026-11-20. Implemented: sessions revoked, login refused while pending, address-keyed rows erased, web pages, corrected copy                                                                                                       | PostGIS integration test passes                                                |
| M3.3  | ✅ DONE 2026-11-20. Password required for `DELETE /v1/account` (R8)                                                                                                                                                                        | Route tests pass                                                               |
| M3.3a | Fix activity detail missing the verification columns (B17)                                                                                                                                                                                 | The 4 "run verification" PostGIS tests pass                                    |
| M3.3b | Fix the weekly rank job's peak carry-forward (B18)                                                                                                                                                                                         | The failing territory-claim-season PostGIS test passes                         |
| M3.4  | Landing handler for email links: a minimal static page served by the API, or Android App Links → screens that call `/email-verification/complete`, `/password-reset/complete`, `/email-change/complete`, `/deletion-request/complete` (B7) | Manual: an email from staging completes each flow. Route tests for the pages.  |
| M3.5  | Mobile "Forgot password" and "Change email" screens                                                                                                                                                                                        | Render tests and a manual staging check                                        |
| M3.6  | Mobile safety: stop-share button, recipient view of a share (`readDelayedSafetyShare`), privacy-zone list and delete                                                                                                                       | Render tests                                                                   |
| M3.7  | Configure the email provider in staging (`EMAIL_*`, `APP_BASE_URL`, webhook secret)                                                                                                                                                        | A staging verification email arrives, and the webhook records a delivery event |
| M3.8  | Login: dummy argon2 verify for unknown emails (R6); `trustProxy` configuration (R4)                                                                                                                                                        | Unit test for constant-path behaviour; config documented                       |

## Milestone 4 — Deployable staging environment

| ID   | Task                                                                                                                                 | Done when                                                  |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| M4.1 | Multi-stage, non-root Dockerfiles for the API and worker (R9); build both in CI                                                      | CI job builds both images                                  |
| M4.2 | Decouple migrations from service boot: a one-shot `migrate` job before rollout; services refuse to start on pending migrations (R10) | Staging deploy runs migrate once; API boot doesn't migrate |
| M4.3 | Pick a host and write a minimal deployment manifest for API, worker and managed Postgres+PostGIS within the ₹3,000/month band        | Staging URL serves `/ready` = ready                        |
| M4.4 | EAS `preview` and `production` profiles get `EXPO_PUBLIC_API_BASE_URL` from EAS env; remove the committed LAN IP (B15)               | A preview APK talks to staging over HTTPS                  |
| M4.5 | Global and route-level rate limiting (`@fastify/rate-limit`, shared store not required at one replica) (R5)                          | Route tests for 429 on claims and auth                     |
| M4.6 | Replace or approve the basemap: remove `/satellite.json` or license it, and set the approved style in EAS env (R7)                   | Product sign-off recorded; app renders the approved style  |
| M4.7 | Firebase project + `google-services.json` via EAS secret file; worker FCM credentials                                                | A staging push arrives on a device                         |
| M4.8 | ✅ DONE 2026-11-20. `scripts/seed-admin.mjs` reads credentials from env and refuses production (R1)                                  | `pnpm seed:admin`                                          |

## Milestone 5 — Field validation (needs devices, not code)

| ID   | Task                                                                                                        | Done when                                                      |
| ---- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| M5.1 | Emulator smoke test of the full loop with synthetic GPS: record → background → upload → derive → XP → claim | Checklist in `docs/` with screenshots                          |
| M5.2 | Verify the headless background sync task on a physical Android device (R14)                                 | Run recorded offline syncs after reconnect with the app closed |
| M5.3 | MMR field study per `docs/territory-field-study.md` (GPS cadence, battery, distance error)                  | Baselines recorded                                             |
| M5.4 | Add a device E2E harness (Maestro) for sign-in, record and claim                                            | Runs in CI on an emulator, or nightly                          |

## Milestone 6 — Content and remaining features

| ID   | Task                                                                                                                                  | Done when                                                |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| M6.1 | Seed 5–10 reviewed MMR curated routes (data task)                                                                                     | `/v1/routes/suggest` returns routes in staging           |
| M6.2 | Import a reviewed quest catalogue via `scripts/data/import-reviewed-quests.mjs`                                                       | `/v1/quests` is non-empty in staging                     |
| M6.3 | Quest lifecycle: accept and complete (server-validated from derived activity) writing `quest_acceptances` and `quest_completions`     | Integration tests; `questsCompleted` no longer hardcoded |
| M6.4 | Competition enrollment from mobile (`enrollCompetition`)                                                                              | Render test                                              |
| M6.5 | ML: add auth to `services/ml` (R2), a `/train` endpoint or change the worker to a job runner (B12), Python tests, deployment decision | pytest suite; token-checked endpoints                    |
| M6.6 | Admin: refresh-token handling or a re-login prompt; support area                                                                      | Admin tests                                              |

## Milestone 7 — Housekeeping (any time, low risk)

| ID   | Task                                                                                                                                                      | Done when                                 |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| M7.1 | Reconcile docs with code: rewrite `docs/pending-work.md` as one current list; fix the README and `architecture.md` scope; record the landing-tab decision | Docs match `IMPLEMENTATION_STATUS.md`     |
| M7.2 | Extract the shared `requireStaffRole` helper; unify staff authz (drop the env allow-list or map it to a role)                                             | One implementation; route tests unchanged |
| M7.3 | Split `territory-claim-routes.ts` into pipeline and service modules plus thin routes                                                                      | No behaviour change; tests pass           |
| M7.4 | Remove tracked `test-claim.ts`; keep `scratch/` ignored                                                                                                   | File gone                                 |
| M7.5 | Replace `react-test-renderer` with `@testing-library/react-native` incrementally                                                                          | Deprecation warnings gone                 |
| M7.6 | Migrate `expo-background-fetch` to `expo-background-task`                                                                                                 | Background sync verified on device        |

## Suggested order

M0 → M1 (M1.1, M1.8 and M1.6 are the biggest user-visible wins) → M2.1/M2.2 → M4 (staging) → M3 →
M5 → M6. M7 can be interleaved.
