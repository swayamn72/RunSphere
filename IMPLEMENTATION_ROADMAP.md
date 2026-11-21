# RunSphere — Implementation Roadmap

> Written 2026-11-20. It is ordered by risk: make the build trustworthy first, then make the core loop
> (record → upload → derive → reward → claim) correct, then make it deployable, then finish features.
> Each task is sized for one small PR, has a clear **done when** check, and can ship on its own.
> IDs like B1 or R4 refer to `BUGS_AND_RISKS.md`.

## Milestone 0 — Green, trustworthy build ✅ DONE 2026-11-20

Goal: CI is green on `main`, and the PostGIS integration suites run and pass. Every later task
depends on this signal. Done on branch `fix/m0-green-ci-and-db-tests`: with `CI=true` and the
PostGIS gate open, format (LF), lint, typecheck, build, migrate and all **2,082 tests pass with 0
skipped**.

| ID   | Task                                                                                                                                       | Status                                                                                                 |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| M0.1 | Remove dead imports from `services/api/src/app.ts` (B14)                                                                                   | ✅ API lint clean                                                                                      |
| M0.2 | Mobile lint: image `require()` → typed ES imports (`src/assets.d.ts`); optional native modules keep a guarded, typed, documented `require` | ✅ Mobile lint clean                                                                                   |
| M0.3 | Remove unused domain `MILLIS_PER_DAY`                                                                                                      | ✅ `pnpm lint` exits 0                                                                                 |
| M0.4 | `verify-android-permissions.mjs`: `fileURLToPath`, `aapt.exe` lookup, clear skip when `aapt` is missing (B13)                              | ✅ `pnpm test` exits 0 on Windows                                                                      |
| M0.5 | Run all PostGIS suites against an isolated `runsphere_test` DB and fix failures (B17, B18, two harness issues)                             | ✅ API 568/568, worker 195/195                                                                         |
| M0.6 | Confirm CI is green on GitHub                                                                                                              | ⏳ Needs the PR's Actions run. Also fixed 32 genuinely unformatted files that kept `format:check` red. |
| M0.7 | Renormalise the local Windows checkout to LF so raw `pnpm format:check` passes locally                                                     | Open. Developer-machine only; CI is unaffected.                                                        |

## Milestone 1 — Core loop correctness

| ID    | Task                                                                                                                                                                                                     | Done when                                                                                                                                        |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| M1.1  | ✅ DONE: Single-flight token refresh in `MobileApiClient` (one shared promise; concurrent 401s await it) (B1)                                                                                            | New unit test: 5 parallel 401s cause exactly 1 refresh call, and all 5 retries succeed                                                           |
| M1.2  | ✅ DONE (30 s reuse window in `rotateSession`): Server: optional 30-second grace for the immediately previous refresh token, so a lost response doesn't revoke the family                                | Integration test: a replay within the grace returns the same family's current token; a replay after it still revokes                             |
| M1.3  | ✅ DONE: Make `processActivity` transactional and idempotent (B9)                                                                                                                                        | Integration test: an injected failure mid-process leaves no partial rows, and a retry succeeds                                                   |
| M1.4  | ✅ DONE (empty runs; too-short runs stay derived, claims refuse them): Reject zero-point and too-short runs explicitly (`rejected`, reason code) per docs fact 15 (B8)                                   | Integration test: an empty activity reaches `rejected` and is not stuck in `validating`                                                          |
| M1.5  | ✅ DONE (superseded: XP is weekly, so a week-close job replaced the per-activity event): Emit `activity.derived` outbox event at the end of `processActivity`                                            | Integration test: one event per derived activity, none on reprocess                                                                              |
| M1.6  | ✅ DONE (progression_week_close job + migration 047): Worker consumer: award progression (XP and weekly consistency) on `activity.derived` (B2)                                                          | Integration test: derive a run, then `GET /v1/progression` shows XP > 0; reprocessing doesn't double-award                                       |
| M1.7  | ✅ DONE (`achievement-core.ts`, called by `processNextActivity` after each run): Worker consumer: evaluate achievements on `activity.derived` (drop the screen-visit dependency)                         | Same pattern as M1.6                                                                                                                             |
| M1.8  | ✅ DONE: Restructure the worker loop: drain queues (activity, challenge, delivery) independently of maintenance; run maintenance jobs on per-job intervals; isolate each job with try/catch and log (B3) | Unit test: a throwing maintenance job doesn't prevent activity processing; with 100 queued activities, all derive without 100 maintenance sweeps |
| M1.9  | ✅ DONE: Weekly goal uses the Asia/Kolkata week (B10)                                                                                                                                                    | Unit test at the Sunday 18:30 UTC boundary                                                                                                       |
| M1.10 | Move `processActivity` and `validateTrace` out of `services/api` into a shared package so the worker no longer depends on `@runsphere/api`                                                               | `services/worker/package.json` has no `@runsphere/api` dependency; tests pass                                                                    |

## Milestone 2 — Turf integrity

| ID   | Task                                                                                                                                                                       | Done when                                                                                                 |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| M2.1 | ✅ DONE: Migration: unique partial index on `territory_claims(activity_id)` (resolve existing duplicates first); route returns an idempotent `already_claimed` result (B4) | Integration test: second claim of the same run returns `already_claimed`, and no new rows appear          |
| M2.2 | ✅ DONE: Mobile: offer only unclaimed derived runs (needs a `claimed` flag on activity list or claim summary)                                                              | Render test: the claim button is hidden after a successful claim                                          |
| M2.3 | ✅ DONE (sorted ~1 km tile advisory locks, `claimLockKeys`): Serialise claims on empty ground with an advisory lock on coarse H3 parents (B5)                              | Integration test: two concurrent claims on the same empty area produce one claim plus one carve or defend |
| M2.4 | ✅ DONE: Atomic Ghost Race limit (an `INSERT … SELECT … WHERE count < 3` or a locked counter) (B11)                                                                        | Integration test: 5 concurrent requests produce exactly 3 successes                                       |
| M2.5 | Mobile: season recap / reset card using the existing `getTerritorySeasonRecap`                                                                                             | Render test plus a manual check on an emulator                                                            |
| M2.6 | Mobile: hall of fame and seasons list (existing client methods)                                                                                                            | Render tests                                                                                              |
| M2.7 | Admin: trade-flag review, concentration and events screens for the existing staff routes                                                                                   | Admin tests cover each staff action                                                                       |

## Milestone 2.5 — UI, UX & Copy Overhaul ("Tactical Night / Neon Turf")

Goal: before anyone outside the team runs with the app (M5 field validation), replace the flat
dark-green look and the legal/technical copy with a high-contrast, game-like identity that is
legible outdoors at a glance, and put the two things that make RunSphere different, **Turf** and
**Ghost Races**, on the surfaces people open first. It sits here because field-study feedback on a
UI that is about to be replaced is wasted, and because it depends only on data M0–M2 already
provide.

**Palette** (single source of truth: `packages/ui/src/index.ts` `SemanticTokens`):

| Role                 | Hex       | Use                                                              |
| -------------------- | --------- | ---------------------------------------------------------------- |
| Canvas               | `#090D16` | App background, map surround                                     |
| Primary accent: Cyan | `#00E5FF` | Primary actions, _your_ territory, live run trace, focus rings   |
| Success: Green       | `#22C55E` | Claims won, goals met, verified, positive deltas                 |
| Rival / danger: Rose | `#F43F5E` | Rival territory, carves against you, destructive actions, errors |

Surfaces are lighter steps of the canvas, not new hues. Every text/background pair must meet WCAG
2.2 AA (4.5:1 body, 3:1 large text and UI glyphs), checked in tests rather than by eye.

Rules for every task:

- Keep logic in `*-model.ts` with unit tests.
- No copy may claim something the server hasn't confirmed (server authority still applies).
- Keep privacy copy where it is _required_ (permissions, deletion, safety), but rewrite it in plain
  language.
- Visual sign-off is one emulator or device screenshot pass at the end of the milestone (UX.12),
  not per task.

| ID    | Task                                                                                                                                                                                                                                                                                                                                                                                         | Done when                                                                                                                                      |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| UX.1  | ✅ DONE (palette de51bf5; full AA matrix test + `text.danger` rose): **Tokens**: replace the dark-green palette in `packages/ui` with the Tactical Night roles above; map existing semantic roles (canvas, surface, action.primary, accent.*, territory owned/rival/neutral, danger) onto it; replace its 45 hard-coded hexes with named steps                                               | `packages/ui` unit test asserts every text/background pair meets AA; `theme.test.ts` updated                                                   |
| UX.2  | ✅ DONE (owner palette moved to `@runsphere/ui`; no-hex guard test): **Contrast audit of screens**: replace remaining inline colours in `apps/mobile/src/components/styles.ts` (1.1k lines) and screens with tokens                                                                                                                                                                          | A test scans `apps/mobile/src` for hex colour literals outside theme files and finds none                                                      |
| UX.3  | ✅ DONE in code (safe-area-context, 64d6d97); emulator check pending: **Status-bar overlap (Android)**: React Native's `SafeAreaView` only insets on iOS. Adopt `react-native-safe-area-context` (`SafeAreaProvider` in `App.tsx`, insets in `ScreenShell`), use light status-bar content on `#090D16`, and revisit the `edgeToEdgeEnabled=false` workaround in `apps/mobile/DEVELOPMENT.md` | Render test: shells apply the top inset from a mocked provider. Manual: no content under the status bar on an Android 14/15 emulator.          |
| UX.4  | ✅ DONE (`SettingsButton`, 64d6d97): **Floating gear overlap**: the absolutely positioned `⚙` in `ProfileOverview.tsx` collides with the header and status bar. Move Settings into the header row with a 44×44 dp hit target and an accessibility label.                                                                                                                                     | Render test finds a labelled "Settings" button in the header row, not absolutely positioned                                                    |
| UX.5  | ✅ DONE (`docs/voice.md`): **Voice guide**: write `docs/voice.md` (short, active, second person, runner vocabulary, no legalese outside legal screens, numbers before adjectives) with before/after examples                                                                                                                                                                                 | Doc merged and referenced from `CLAUDE.md`                                                                                                     |
| UX.6  | ✅ Done (`voice-copy.test.ts` scans every screen string for banned system words and shaming phrases): **Copy: core screens**: rewrite Home, Run (prep/live/results), Map/Turf, Social and Profile strings per the voice guide, moving them into each screen's `*-model.ts` so they're testable                                                                                               | Model tests cover key strings; a banned-phrase test ("provenance", "derivation", "canonical", "policy version", …) passes for user-facing copy |
| UX.7  | ✅ Done (`failure-copy.ts`; GPS copy in `live-activity-model.ts`): **Copy: errors and empty states**: plain, actionable messages for offline, weak GPS, session ended, server unavailable, no curated routes and no quests                                                                                                                                                                   | Each non-state in `docs/product.md` has one tested message; no raw status codes or exception text reach the UI                                 |
| UX.8  | ✅ Done: coach card on Home (592af6c); `rho-coach.ts` cues with a tone test, shown before, during and after a run: **Rho as field coach**: give Rho (`crew.ts`, `loop-guidance.ts`) a field-coach persona (calm, direct, tactical cues such as "Hold this line 400 m to close the loop") for pre-run, mid-run and post-run moments. Stays pace-neutral (ADR-0005) and never shames.          | `loop-guidance` tests cover each moment; a tone test rejects shaming or pace-pressure phrases; `isSafeMascotLabel()` still passes              |
| UX.9  | ✅ DONE (Turf area on Home, 64d6d97/592af6c): **Home: Turf strip**: a compact card with your held area, city rank and days left in the season, from the existing claim summary and leaderboard reads, linking to Map                                                                                                                                                                         | `home-dashboard-model` tests for loaded, no-claims and offline states; render test                                                             |
| UX.10 | ✅ DONE (`ghostAvailable` on claims, `ghostRacesLeft` on summary, Map offer + Home card): **Home + Map: Ghost Race entry points**: a "Race a ghost" card on Home (nearest rival claim with a ghost available) and a visible Ghost Race chip on rival claims on Map, both opening the existing `GhostRaceSheet`, showing races left this hour                                                 | Model tests for available, rate-limited and none-nearby; render tests for both entry points                                                    |
| UX.11 | ✅ DONE (status colours 01b49ea; `TURF_LEGEND` tied to the map palette; stats via existing summary line): **Map: territory stats overlay**: your area, claims held and contested this week, in the new palette (cyan = yours, rose = rival), with a legend                                                                                                                                   | `territory-model` tests; render test of the legend and overlay states                                                                          |
| UX.12 | **Visual QA pass**: emulator screenshots of every tab and the run flow at high brightness and at 200% font scale; fix any truncation and overlap found                                                                                                                                                                                                                                       | Screenshot checklist committed under `docs/design/qa/`; no clipped text at 200% font scale                                                     |

Order: UX.1 → UX.2 → (UX.3, UX.4); UX.5 → (UX.6, UX.7, UX.8); UX.9–UX.11 after UX.1; UX.12 last.
UX.10 is better after M2.4 (atomic ghost limit), so "races left this hour" is exact.

## Milestone 2.6 — Social identity and privacy controls (ADR-0014)

Usernames, discovery and the privacy controls the runner owns. The server enforces every control.

| #    | Task                                                                                                                                    | Acceptance                                           |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| SI.1 | ✅ Usernames, date of birth (18+), home area, privacy settings, search, profile by username, friend request by username (migration 050) | Integration tests for every visibility rule          |
| SI.2 | ✅ Enforce Turf controls (anonymous holder, hidden ground, Ghost Race opt-out) and the friend board switch                              | Unit and integration tests                           |
| SI.3 | ✅ Invite links and QR codes (hashed, 7-day tokens; migration 051; the app needs the `runsphere://` scheme, see SI.6)                   | Integration tests; a used or expired link is refused |
| SI.4 | App: onboarding steps (date of birth, username, visibility, home area, privacy zone prompt)                                             | Render tests; copy passes voice-copy.test            |
| SI.5 | App: Privacy & visibility screen, plus a one-time review prompt for existing accounts                                                   | Render tests                                         |
| SI.6 | App: search, profile pages, tap a name on Turf or a board to open a profile, QR scan and share                                          | Render tests                                         |
| SI.7 | Run controls (who sees my runs, route maps, start times) take effect when a run feed exists; stored now                                 | Applies with the feed                                |
| SI.8 | Operator: privacy policy and terms for public profiles, a named grievance officer, legal review                                         | Owner task, before launch                            |

## Milestone 3 — Accounts, email and safety actually work

| ID    | Task                                                                                                                                                                                                                                                                        | Done when                                                                      |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| M3.1  | ✅ DONE 2026-11-20. Deletion policy decided: immediate, verified, complete (ADR-0012)                                                                                                                                                                                       | —                                                                              |
| M3.2  | ✅ DONE 2026-11-20. Implemented: sessions revoked, login refused while pending, address-keyed rows erased, web pages, corrected copy                                                                                                                                        | PostGIS integration test passes                                                |
| M3.3  | ✅ DONE 2026-11-20. Password required for `DELETE /v1/account` (R8)                                                                                                                                                                                                         | Route tests pass                                                               |
| M3.3a | Fix activity detail missing the verification columns (B17)                                                                                                                                                                                                                  | The 4 "run verification" PostGIS tests pass                                    |
| M3.3b | Fix the weekly rank job's peak carry-forward (B18)                                                                                                                                                                                                                          | The failing territory-claim-season PostGIS test passes                         |
| M3.4  | Landing handler for email links: a minimal static page served by the API, or Android App Links → screens that call `/email-verification/complete`, `/password-reset/complete`, `/email-change/complete`, `/deletion-request/complete` (B7)                                  | Manual: an email from staging completes each flow. Route tests for the pages.  |
| M3.5  | Mobile "Forgot password" and "Change email" screens                                                                                                                                                                                                                         | Render tests and a manual staging check                                        |
| M3.6  | 🟡 Stop-share and the privacy-zone list/delete done (`GET`/`DELETE /v1/privacy-zones`); the recipient view needs a "shares sent to me" endpoint first: Mobile safety: stop-share button, recipient view of a share (`readDelayedSafetyShare`), privacy-zone list and delete | Render tests                                                                   |
| M3.7  | Configure the email provider in staging (`EMAIL_*`, `APP_BASE_URL`, webhook secret)                                                                                                                                                                                         | A staging verification email arrives, and the webhook records a delivery event |
| M3.8  | ✅ DONE (TRUST_PROXY is opt-in): Login: dummy argon2 verify for unknown emails (R6); `trustProxy` configuration (R4)                                                                                                                                                        | Unit test for constant-path behaviour; config documented                       |

## Milestone 4 — Deployable staging environment

| ID   | Task                                                                                                                                                      | Done when                                                  |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| M4.1 | Multi-stage, non-root Dockerfiles for the API and worker (R9); build both in CI                                                                           | CI job builds both images                                  |
| M4.2 | Decouple migrations from service boot: a one-shot `migrate` job before rollout; services refuse to start on pending migrations (R10)                      | Staging deploy runs migrate once; API boot doesn't migrate |
| M4.3 | Pick a host and write a minimal deployment manifest for API, worker and managed Postgres+PostGIS within the ₹3,000/month band                             | Staging URL serves `/ready` = ready                        |
| M4.4 | EAS `preview` and `production` profiles get `EXPO_PUBLIC_API_BASE_URL` from EAS env; remove the committed LAN IP (B15)                                    | A preview APK talks to staging over HTTPS                  |
| M4.5 | ✅ Done (in-memory limiter, `rate-limit.ts`): Global and route-level rate limiting (`@fastify/rate-limit`, shared store not required at one replica) (R5) | Route tests for 429 on claims and auth                     |
| M4.6 | Replace or approve the basemap: remove `/satellite.json` or license it, and set the approved style in EAS env (R7)                                        | Product sign-off recorded; app renders the approved style  |
| M4.7 | Firebase project + `google-services.json` via EAS secret file; worker FCM credentials                                                                     | A staging push arrives on a device                         |
| M4.8 | ✅ DONE 2026-11-20. `scripts/seed-admin.mjs` reads credentials from env and refuses production (R1)                                                       | `pnpm seed:admin`                                          |

## Milestone 5 — Field validation (needs devices, not code)

| ID   | Task                                                                                                        | Done when                                                      |
| ---- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| M5.1 | Emulator smoke test of the full loop with synthetic GPS: record → background → upload → derive → XP → claim | Checklist in `docs/` with screenshots                          |
| M5.2 | Verify the headless background sync task on a physical Android device (R14)                                 | Run recorded offline syncs after reconnect with the app closed |
| M5.3 | MMR field study per `docs/territory-field-study.md` (GPS cadence, battery, distance error)                  | Baselines recorded                                             |
| M5.4 | Add a device E2E harness (Maestro) for sign-in, record and claim                                            | Runs in CI on an emulator, or nightly                          |

## Milestone 6 — Content and remaining features

| ID   | Task                                                                                                                                                                          | Done when                                                |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| M6.1 | Seed 5–10 reviewed MMR curated routes (data task)                                                                                                                             | `/v1/routes/suggest` returns routes in staging           |
| M6.2 | Import a reviewed quest catalogue via `scripts/data/import-reviewed-quests.mjs`                                                                                               | `/v1/quests` is non-empty in staging                     |
| M6.3 | Quest lifecycle: accept and complete (server-validated from derived activity) writing `quest_acceptances` and `quest_completions`                                             | Integration tests; `questsCompleted` no longer hardcoded |
| M6.4 | Competition enrollment from mobile (`enrollCompetition`)                                                                                                                      | Render test                                              |
| M6.5 | ⏸ DEFERRED (ADR-0013, no ML at launch): ML: add auth to `services/ml` (R2), a `/train` endpoint or change the worker to a job runner (B12), Python tests, deployment decision | pytest suite; token-checked endpoints                    |
| M6.6 | Admin: refresh-token handling or a re-login prompt; support area                                                                                                              | Admin tests                                              |

## Milestone 7 — Housekeeping (any time, low risk)

| ID   | Task                                                                                                                                                      | Done when                                 |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| M7.1 | Reconcile docs with code: rewrite `docs/pending-work.md` as one current list; fix the README and `architecture.md` scope; record the landing-tab decision | Docs match `IMPLEMENTATION_STATUS.md`     |
| M7.2 | Extract the shared `requireStaffRole` helper; unify staff authz (drop the env allow-list or map it to a role)                                             | One implementation; route tests unchanged |
| M7.3 | Split `territory-claim-routes.ts` into pipeline and service modules plus thin routes                                                                      | No behaviour change; tests pass           |
| M7.4 | ✅ DONE 2026-11-20: Removed tracked `test-claim.ts`; `scratch/` stays ignored                                                                             | File gone                                 |
| M7.5 | Replace `react-test-renderer` with `@testing-library/react-native` incrementally                                                                          | Deprecation warnings gone                 |
| M7.6 | Migrate `expo-background-fetch` to `expo-background-task`                                                                                                 | Background sync verified on device        |

## Suggested order

M0 ✅ → M1 (M1.1, M1.8 and M1.6 are the biggest user-visible wins) → M2.1/M2.2 → **M2.5 (UI, UX and copy)** → M4 (staging) → M3 → M5 (field validation) → M6. M7 can be interleaved.
