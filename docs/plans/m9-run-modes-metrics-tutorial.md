# M9 — Independent run modes, run metrics, run log and detail, guided tour

> Written 2026-11-22 with the owner. This is the working plan for the 15-day closed beta that starts
> 2026-11-23. Each task is one small PR: branch from `main`, lint, typecheck, affected tests (PostGIS
> suites against `runsphere_test` when DB code changes), fast-forward merge, push, and tick the task
> here and in `IMPLEMENTATION_ROADMAP.md` (M9) in the same commit. Read `CLAUDE.md` first.

## Handoff (end of session, 2026-11-22)

- **Done:** 9.0–9.5. Runs store their mode; the server checks it at start (quest accepted, ghost
  claim raceable) and enforces it (only Turf/Ghost/pre-mode runs claim; a quest run completes only
  its quest). The app now starts every run with a mode (`start-run`, `src/run-start.ts`) and sends
  it on create. Home, the Run tab, the Map and suggested routes start Turf runs until the picker
  lands; quest detail starts a quest run once the quest is taken on; a rival's ground starts a
  Ghost Race.
- **Upload fallback:** the server checks the mode when the run is created, which happens at upload.
  If it refuses (ground changed hands, quest closed), a Ghost Race is kept as Turf and a Quest run
  as Free, so the run is never stuck. 9.7's result screen should say when that happened.
- **Next up: 9.6** (mode picker) and **9.7** (per-mode HUD and result).
- **Known, pre-existing:** `services/worker/src/territory-claim-season.integration.test.ts` fails
  against the local `runsphere_test` database on `main` too (rank and season-warning cases see
  leftover data). See B19. Exclude it locally until fixed; CI uses a fresh database.

## 0. How the app works today (verified in code, 2026-11-22)

- **One recorder for everything.** Every run starts through `start-free` (`apps/mobile/src/activity-flow.ts`)
  and records the same way. A run's "mode" isn't stored anywhere.
- **Turf:** after any run, if the route closes a loop, the runner can claim the ground inside
  (`POST /v1/territory/claims`, `services/api/src/territory-claim-routes.ts`). One claim per run
  (migration 048).
- **Quest:** the runner accepts a quest first. The server then checks **derived runs recorded after
  acceptance** (`services/api/src/quest-core.ts`, called by the worker): place/area checkpoints count
  if the trace passes within 30 m; route checkpoints need 80% of the path covered within 30 m; GPS
  accuracy must be 50 m or better. **Checkpoints can be visited in any order**, but **all of them must
  be in the same run**. A quest completes once per account. Quests have published opening hours. No
  XP (ADR-0005).
- **Ghost Race:** started by tapping **someone else's currently held claim** (Turf map →
  `TerritoryDetailScreen` → `GhostRaceSheet`). Their recorded loop plays on your map as a ghost
  moving at their real pace; a card says who's ahead. Server rules
  (`GET /v1/territory/claims/:claimId/ghost-trace`): the claim must still be held, not your own, no
  block either way, same city region (or you hold no ground yet), **3 per hour**. 200 m is trimmed
  from each end of the ghost; a loop too short after trimming has no ghost. It changes no rule:
  afterwards the run is carved like any other. The server doesn't check where you are, so it can be
  started from anywhere, but only from a rival's claim, never from a blank map or your own ground.
- **Metrics stored:** distance, active duration, point counts. The shareable route is a privacy-trimmed
  `MultiLineString` without timestamps (`activity_derivations.shareable_route`). **Raw points are
  purged after 30 days** (`raw_trace_retention_until`, worker `raw_trace_purge`), so splits, charts
  and best efforts must be computed when the run is derived and stored.
- **Run visibility settings exist but nothing reads them:** `privacy_settings.runs_visibility`
  (default `friends`), `show_route_maps` (default true), `show_start_times` (default false) (SI.7).
- **No navigation or animation library.** Navigation is app state in `App.tsx` and
  `activity-flow.ts`. Maps are `@maplibre/maplibre-react-native`. The mascot components
  (`Mascot.tsx`, `CrewMascot.tsx`) avoid `react-native-svg` and are static by policy
  (`docs/mascot-assets.md`).
- **Bug:** onboarding's "Trim saved places" switch (`hideStartFinish`, `apps/mobile/src/onboarding.ts`)
  is never sent to the server, so it does nothing.

## 1. Decisions (owner, 2026-11-22)

1. **Modes are independent.** The runner picks one of four at the start; each has its own prepare
   screen, live HUD and result screen; the mode is stored on the run and the **server enforces it**:

   | Mode       | Needs at start             | Can claim ground?          | Can complete a quest? |
   | ---------- | -------------------------- | -------------------------- | --------------------- |
   | Free run   | nothing                    | no                         | no                    |
   | Turf       | nothing (loop guide shown) | yes                        | no                    |
   | Quest      | an accepted quest          | no                         | yes, only that quest  |
   | Ghost Race | a rival's held claim       | yes (same carving as Turf) | no                    |

   Runs recorded before migration 053 have no mode and keep today's behaviour (claimable, quest
   evaluation as now), so nothing in flight breaks.

   > Recommendation recorded: let Ghost Race runs claim, because taking the ground is the point of
   > racing for it. Change the table if the owner decides otherwise.

2. **Every run shows full metrics** to its owner (section 3).
3. **Start and finish markers are shown.** The owner sees their real start and finish. Other people see
   the trimmed route's ends; if the runner has "Trim start and finish" on (default on), the first and
   last 200 m are also cut for viewers even without a privacy zone.
4. **Opening a run is animated:** the card expands into the detail screen and the route draws itself
   (section 5).
5. **A guided tour** with blur, a spotlit button and an animated Rho (section 6).
6. Still to confirm with the owner before 9.5 ships: who sees others' runs by default. The plan
   assumes friends see stats, and see the route only if `show_route_maps` is on, with a one-time
   "Who sees your runs?" prompt before anything becomes visible.

## 2. Phase A — Modes (build 2)

| ID  | Task                                                                                                                                                                                                                                                                                                                                                            | Files                                                                                                        | Done when                                                                   |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| 9.0 | ✅ DONE 2026-11-22: `privacy_settings.trim_start_finish` (default true, migration 053); onboarding saves it when turned off; Privacy settings has "Hide start and finish". The run log (9.14) applies it                                                                                                                                                        | `onboarding.ts`, `OnboardingScreen.tsx`, `privacy-settings-model.ts`, `social-identity-routes.ts`, contracts | Switch state round-trips; integration test                                  |
| 9.1 | ✅ DONE 2026-11-22 (migration 054; columns are `run_mode`, `quest_version_id`, `ghost_claim_id`): Migration 054: `activity_submissions.run_mode text CHECK (run_mode IN ('free','turf','quest','ghost'))`, nullable for old runs, plus `quest_id uuid` and `ghost_claim_id uuid` (FKs, `ON DELETE SET NULL`); document rollback                                 | `infra/postgres/migrations/054_*.sql`                                                                        | `pnpm verify:migrations` passes                                             |
| 9.2 | ✅ DONE 2026-11-22: Contracts: `runMode`, `questId`, `ghostClaimId` on `ActivityCreateRequestSchema` with rules (quest needs questId, ghost needs ghostClaimId, others neither) and on status/detail responses                                                                                                                                                  | `packages/contracts/src/index.ts`                                                                            | Contract tests                                                              |
| 9.3 | ✅ DONE 2026-11-22 (checks moved to `ghost-race-access.ts`; `run-modes.integration.test.ts`): API create route stores and validates them (quest must be accepted and open; ghost claim must pass the same checks as the ghost-trace route, extracted into one shared function)                                                                                  | `activity-routes.ts`, `territory-claim-routes.ts`                                                            | Route + PostGIS tests for each refusal                                      |
| 9.4 | ✅ DONE 2026-11-22 (`claimModeRefusal`; Turf screen skips free/quest runs): Server enforcement: the claim route refuses `free` and `quest` runs with a clear message; quest evaluation only considers `quest` runs for **their** quest (and legacy null-mode runs as today)                                                                                     | `territory-claim-routes.ts`, `quest-core.ts`, worker                                                         | PostGIS tests: a free run can't claim; a quest run completes only its quest |
| 9.5 | ✅ DONE 2026-11-22 (`src/run-start.ts`; recorder schema 10; until 9.6 the default is Turf; quest detail starts a quest run only once taken on; a mode refused at upload falls back, Ghost→Turf and Quest→Free, so the run still saves): Mobile flow: replace `start-free` with `start-run { mode, questId?, ghostClaimId? }`; the local session stores the mode | `activity-flow.ts`, `activity-recorder-core.ts` (local schema migration), `App.tsx`                          | Flow + recorder unit tests                                                  |
| 9.6 | Run tab mode picker: four large cards (Free run · Turf · Quest · Ghost Race), each one line on what it does; Quest opens the accepted/available quests; Ghost Race opens the map with a hint "Tap a rival's ground to race it" (and a clear empty state if none nearby or limit reached)                                                                        | new `RunModePicker.tsx` + `run-mode-model.ts`                                                                | Render tests; voice-copy test passes                                        |
| 9.7 | Mode-specific live HUD and result: Free = stats only; Turf = loop guide + "Close the loop" distance + claim on finish; Quest = checkpoint list ticking off locally as you pass within 30 m (server still decides) + result; Ghost = existing ghost card + claim on finish                                                                                       | `ActivityScreens.tsx` (split by mode into components), models                                                | Render tests per mode                                                       |

## 3. Phase B — Metrics engine (build 2)

| ID   | Task                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Files                                                                                               | Done when                               |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------- |
| 9.8  | Pure `run-metrics.ts` from accepted points: elapsed time; moving time (stopped = under 0.5 m/s for 10 s+); distance; average and moving pace; km splits (time, pace, elevation change; partial last km); fastest km; best efforts (400 m, 1 km, 1 mile, 5 km, 10 km, half) by sliding window; elevation gain/loss with median smoothing and 3 m hysteresis; max/min elevation; pace and elevation series downsampled to ≤200 points of (distance, value) with no coordinates | `packages/domain/src/run-metrics.ts` + tests with synthetic traces (loop, stops, hills, GPS spikes) | Unit tests; no `h3-js`                  |
| 9.9  | `activity_metrics` table (migration 055) and compute it inside `processActivity`'s transaction, idempotent on `activity_id`; `metrics_version` column                                                                                                                                                                                                                                                                                                                        | `activity.ts`, migration                                                                            | PostGIS test: a derived run has metrics |
| 9.10 | Backfill job for derived runs without metrics whose raw points still exist                                                                                                                                                                                                                                                                                                                                                                                                   | worker job file                                                                                     | Worker test                             |
| 9.11 | Contracts `ActivityMetricsSchema`; include in `GET /v1/activities/:id`                                                                                                                                                                                                                                                                                                                                                                                                       | contracts, `activity-routes.ts`                                                                     | Route tests                             |
| 9.12 | Instant local preview on the finish screen from on-device samples (same domain function), replaced by the server's numbers when derived; labelled "Checking…" until then                                                                                                                                                                                                                                                                                                     | `ActivityScreens.tsx`                                                                               | Render test                             |

Not in this milestone (each needs new data or a permission, and a policy update): heart rate (Health
Connect / BLE; changes the Play health declaration), cadence (needs `ACTIVITY_RECOGNITION` back),
calories (needs body weight), effort/fitness scores, segments, kudos/comments. Use RunSphere's own
names for metrics, not another product's trademarks. Metrics never affect XP or scores (ADR-0005).
Copy never judges pace (`docs/voice.md`).

## 4. Phase C — Run log (build 3)

| ID   | Task                                                                                                                                                                                                                 | Done when                                               |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 9.13 | `GET /v1/activities?cursor=` paginated (20 per page): summary, key metrics, mode, mode result (area claimed / quest done / ghost won-lost), and a simplified route thumbnail (Douglas-Peucker to ≤100 points)        | Route tests                                             |
| 9.14 | `GET /v1/profiles/:username/runs?cursor=` applying `runs_visibility`, `show_route_maps`, `show_start_times`, `trim_start_finish` and blocks on the server; trimmed route only; date only when start times are hidden | PostGIS test matrix over every setting                  |
| 9.15 | Profile "Runs" section (yours and others'): cards grouped by week, each with an SVG route thumbnail (not a map per row), distance, time, pace, mode badge                                                            | Render tests; smooth with 100 runs on a mid-range phone |

## 5. Phase D — Run detail, transition and the drawn route (build 3)

New native dependencies (one build; `apps/mobile/android` is hand-edited, so **don't run
`expo prebuild`**; autolinking picks them up): `react-native-reanimated` 4 + `react-native-worklets`
(new architecture is already on), `react-native-svg`, `expo-blur` (for section 6). Add the Reanimated
Babel plugin as its docs require for Expo 57.

| ID   | Task                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Done when                                                      |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 9.16 | `RunDetailHost` overlay above the tab content (keep the app's own navigation; don't migrate to React Navigation mid-beta). Android back and swipe-down close it                                                                                                                                                                                                                                                                                                                                                                                                                   | Render test; back closes                                       |
| 9.17 | **Open transition:** on tap, measure the card (`measureInWindow`), render the detail at that rect, and animate position, size and corner radius to full screen over ~350 ms (spring, no overshoot past the screen); the card's thumbnail cross-fades into the map; content below slides up 24 px and fades in, staggered 40 ms per section. Closing plays it in reverse to the card's current position                                                                                                                                                                            | Visual check on device; no dropped frames on a mid-range phone |
| 9.18 | **Route drawing:** once the map is ready, fit the camera to the route bounds with padding, then draw the line from start to finish over ~1.2 s (ease-out) by updating the GeoJSON source with a growing slice of the coordinates at ≤30 fps (MapLibre has no trim-offset). The line is coloured by pace with `line-gradient` (`lineMetrics: true`) using colours from `theme/game-world.ts` only; a glowing head dot follows the tip; start and finish markers pop in at the start and end of the draw. **Reduce motion:** show the whole line and markers at once, no camera fly | Unit test for the slicing/timing model; device check           |
| 9.19 | Detail layout: map (~55% height, collapses as you scroll), mode badge + mode result card, stats grid (distance, moving time, pace, elapsed, elevation gain, best km), km splits table with relative bars, pace and elevation charts (SVG) that you can scrub (a vertical cursor shows the value at that distance and moves a dot on the map), best efforts, and Delete with a confirmation and error handling (fixes C.8 follow-up)                                                                                                                                               | Render tests; voice-copy test                                  |
| 9.20 | Viewer rules on the detail screen: someone else's run shows only what 9.14 returns (no map if route maps are off; trimmed ends; date only if start times are hidden)                                                                                                                                                                                                                                                                                                                                                                                                              | Render tests for each case                                     |

## 6. Phase E — Guided tour (build 3)

| ID   | Task                                                                                                                                                                                                                                                                                                                                                                                                                            | Done when                        |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| 9.21 | `tutorial-model.ts`: steps `{ id, targetId, tab, title, rhoLine, placement }`, next/back/skip, versioned completion stored per account on the device; "Replay the tour" in Settings. Copy passes `rho-coach` tone test and `voice.md`                                                                                                                                                                                           | Unit tests                       |
| 9.22 | `TutorialTarget` wrapper that registers a button's on-screen rect (`measureInWindow`; re-measures on layout, scroll, rotation, keyboard)                                                                                                                                                                                                                                                                                        | Unit/render tests                |
| 9.23 | Overlay: four `expo-blur` panels around the target (a blur can't have a hole cut in it) plus a dim layer, a rounded highlight ring that pulses gently, and a speech bubble placed on the side with room. Falls back to plain dim where blur isn't supported. Tapping outside does nothing; Next/Back/Skip are always visible. Moving between steps glides the ring to the next target; a step on another tab switches tab first | Render tests; device check       |
| 9.24 | Animated Rho: render Rho with `react-native-svg` and animate float, blink, wave and point (Reanimated); the bubble text types on. Update `docs/mascot-assets.md` to allow Rho's tour animations (Loop stays static). Reduce motion: no float, no typing, fade only                                                                                                                                                              | Tone test; device check          |
| 9.25 | First tour after sign-up: Run button → the four modes → Map (your ground and rivals) → a rival's ground (Ghost Race) → Quests → Profile run log. Accessibility: TalkBack reads each step, focus stays in the tour                                                                                                                                                                                                               | Render test of the full sequence |

## 7. Phase F — Privacy, legal and release (must ship in the same build as 9.14/9.15)

| ID   | Task                                                                                                                                                                                                                             |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 9.26 | Update `services/api/src/legal-pages.ts`: others may see your runs, stats and route per your settings; start/finish trimming; bump `LEGAL_POLICY_VERSION` so everyone re-accepts; keep the draft banner until legal review (C.7) |
| 9.27 | One-time "Who sees your runs?" prompt before any run becomes visible to others, defaulting to the owner's decision in section 1.6                                                                                                |
| 9.28 | Update `docs/play-store-submission.md` (content rating: location shared with other users; Data safety unchanged as long as nothing goes to third parties) and `docs/safety-and-privacy.md`                                       |
| 9.29 | Release checks per build: device run with the screen locked (C.3), each mode end to end, route drawing on a low-end phone, tour with TalkBack, battery over a 30-minute run                                                      |

## 8. Schedule against the beta

| When                   | Ship                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------- |
| 2026-11-23             | Current build to closed testing, after one screen-locked device run                   |
| Build 2 (about day 5)  | 9.0–9.12                                                                              |
| Build 3 (about day 11) | 9.13–9.29 (native deps, run log, detail + transitions, tour, privacy update together) |
| Days 12–15             | Beta feedback and fixes                                                               |
