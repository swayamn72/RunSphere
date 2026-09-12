# Pending Work

**Last updated:** 2026-09-12 (v6 — Section 1 re-verified against the code; 1.2/1.3/1.4 were stale, 1.5 fixed)
This document is the single source of truth for what work is not yet done. An agent starting a new task should read this file first and update it as work is completed.

> [!IMPORTANT]
> **What was implemented in the 2026-09-07 pull:** Migrations 036–043 (H3 carving, monthly seasons, geo-tags, running-only, automatic friend board, curated routes, notification catalogue, Ghost Race DB), all domain carving functions, Ghost Race domain + DB, season reset worker, rank worker, geo-backfill worker, notification catalogue (all 12 types), territory-claim-snapshots worker. These are **DONE** and do not need to be re-implemented.

---

## Priority Legend
- 🔴 **BLOCKER** — Android v1 cannot ship without this.
- 🟠 **IMPORTANT** — Required for a specific gated feature or user-facing quality.
- 🟡 **PLANNED** — Approved and in scope; not yet started.
- 🔵 **KNOWN GAP** — Known issue documented but no implementation decision taken yet.
- ✅ **DONE** — Implemented and verified in code review.

---

## 1. Android v1 Launch Blockers 🔴

### 1.1 FCM (Push Notifications) — External Config Only
- Firebase project not created.
- `google-services.json` not added to `apps/mobile/android/`.
- Worker's FCM HTTP v1 sender has no service-account credentials.
- **Note:** The notification pipeline (all 12 types, durable inbox, delivery logic) is fully implemented in code. This is purely a cloud credential configuration task.

### 1.2 Mascot Artwork — ✅ NOT A BLOCKER (verified 2026-09-12)
- All five crew characters have hand-authored vector art in
  `apps/mobile/assets/mascot/crew/` (`crew-{rho,mira,coda,bram}-{light,dark}.svg`),
  alongside Loop's nine state illustrations.
- `crew-assets.ts` exports an **empty** `crewImageOverrides`; every `require()`
  in it is commented out, so nothing resolves a missing path and no asset error
  is raised. `CrewMascot.tsx` draws a dependency-free vector stand-in whenever
  an override is absent, which is the current state for all four crew members.
- Nothing renders broken or blank. The earlier entry describing missing-asset
  errors did not match the code.
- **Remaining (optional, not a launch gate):** raster art to replace the vector
  prototypes. Dropping a PNG under that directory and uncommenting the matching
  entry is the whole swap. Spec in `docs/mascot-assets.md`.

### 1.3 Onboarding Screen — Remove Walk/Hike UI — ✅ DONE (verified 2026-09-12)
- `OnboardingScreen.tsx` and `onboarding.ts` contain no walk/hike references.
- The DB (`040_running_only_and_automatic_friend_board.sql`) enforces
  `movement_type = 'run'`, and the UI now agrees.

### 1.4 Friend Leaderboard — Remove Opt-In Toggle from UI — ✅ DONE (verified 2026-09-12)
- `PlayScreen.tsx` contains no "join board" button and no friend-scope opt-in
  affordance. Mutual friendship alone puts two runners on each other's board.

### 1.5 App.tsx: Default Tab Must Be Turf, Not Home — ✅ DONE (2026-09-12)
- Bar order in `src/navigation/types.ts` is now
  `['Turf', 'Home', 'Explore', 'Play', 'Clubs', 'You']`, matching `screens.md`.
- The landing tab is stated once as `landingTab` in that file. `App.tsx` reads
  it for the first render **and** for the post-sign-out reset, which had its own
  separate hardcoded `'Home'`.
- `tab-style.test.ts` asserts both the order and that `tabs[0] === landingTab`.

### 1.6 PostGIS Integration Tests (skipped without a database)
- The PostGIS suites are gated behind `RUN_POSTGIS_INTEGRATION` plus a
  `DATABASE_URL`/`POSTGRES_PASSWORD` (`postgisIntegrationEnabled` in
  `packages/db`). With the gate closed, a local run reports 98 skipped in
  `@runsphere/api` and 35 in `@runsphere/worker` and is still green.
- CI already runs them: `.github/workflows` starts a PostGIS service and
  `requirePostgisInCi` turns a closed gate in CI into a hard failure, so a green
  CI run does mean they executed.
- **Action required locally:** bring up `infra/compose.yaml --profile local` and
  set `RUN_POSTGIS_INTEGRATION=1` in `.env` before these exercise real SQL.

---

## 2. Territory API Routes — Verify and Complete 🔴

The DB schema (migrations 036–043) and domain logic (`territory-claim.ts`, `ghost-race.ts`, `h3-indexer.ts`) are complete. The worker jobs are complete. **The API route handlers that wire them together need verification and likely completion.**

### 2.1 Territory Claim Submission Route
**File:** `services/api/src/territory-claim-routes.ts`

Verify (and complete if missing) that the run submission pipeline does all of the following in a single DB transaction:
1. Receive GPS trace from mobile
2. Run `detectLoopClaim` to find the closed loop
3. Compute H3 cell set via `h3CellSet(boundary, 11, h3Indexer)`
4. Query overlapping live claims: `SELECT * FROM territory_claims WHERE h3_cell_set && $1 AND released_at IS NULL AND season_month = $2` (uses GIN index from migration 036)
5. For each overlapping claim: run `assessCarve(params)` to get decision, `effortGrace`, `effectiveSpeed`
6. If `decision = 'carve'`: compute `differenceCells` for holder's remaining cells, run `largestConnectedComponent` on remaining cells, update holder's claim boundary and cell set
7. Write new claim row with `h3_cell_set`, `h3_version`, `h3_resolution`, `season_month`, `parent_claim_id`
8. Write `territory_claim_takeovers` row with `kind='carve'`, `carved_area_sqm`, `effort_ratio`, `grace_applied`, `effective_speed_mps`, `holder_speed_mps`
9. If `decision = 'no_contest'`: write `territory_claim_attempts` row
10. Call `tagClaimPlace` to set `city_tag`, `country_tag`, `continent_tag`
11. Build ghost trace via `ghostTraceFrom` and write to `territory_claim_ghost_traces`

### 2.2 Ghost Race API Route
**File:** `services/api/src/territory-claim-routes.ts`

- `GET /territory/claims/:id/ghost-trace`
- Check that the requesting user has not exceeded 3 ghost views in the last hour (query `territory_claim_ghost_views`)
- Return the trimmed trace from `territory_claim_ghost_traces`
- Write a row to `territory_claim_ghost_views`
- Send `GHOST_INCOMING` notification to the claim holder (via the durable inbox)
- Return `404` if no ghost trace exists (too short to trim), `429` if rate limit hit

---

## 3. Leaderboard API Endpoints 🔴

These endpoints do not yet exist. Without them, the Turf leaderboard tabs have no data.

**File:** `services/api/src/territory-board-routes.ts` (create or update)

Required endpoints:
```
GET /territory/leaderboard/city/:cityTag
GET /territory/leaderboard/country/:countryCode
GET /territory/leaderboard/global
GET /territory/leaderboard/season/:seasonMonth
GET /territory/leaderboard/hall-of-fame
```

Each endpoint returns: `rank`, `displayName`, `mascotKey`, `totalAreaSqm`, `seasonMonth`. No coordinates, no route data, no run counts.

- City and country boards: read from `territory_claims` filtered by `city_tag`/`country_tag` WHERE `released_at IS NULL AND season_month = current_month`
- Global board: top 50 only (privacy/scale). Global opt-in is required — query `leaderboard_opt_ins WHERE scope='global'`.
- Takeover feed: `GET /territory/feed` — returns the last 50 `territory_claim_takeovers` events with holder and challenger display names.

---

## 4. Mobile — Turf Tab Completion 🟠

### 4.1 Leaderboard Sheet — City/Country/Global Tabs
**File:** `apps/mobile/src/screens/TurfScreen.tsx`

Current state: TurfScreen has placeholder leaderboard content. It needs:
- Three-tab sheet: **My City | My Country | Global**
- Auto-select the user's city tab based on their own claims' `city_tag` (or default to Global if no claims)
- Global tab shows top 50 only with user's own row pinned at the bottom if outside top 50
- Takeover feed tab showing the last 50 carve/defend events

### 4.2 Season Countdown Banner
**File:** `apps/mobile/src/screens/TurfScreen.tsx`

Top-left of the Turf map:
- Season badge: `"OCT · 12 days left"` — calculate from current date to end of month
- Rank badge: `"#4 in Mumbai"` — from the city leaderboard API

### 4.3 Season Reset Full-Screen Card
**File:** `apps/mobile/src/screens/TurfScreen.tsx` or a new `SeasonResetScreen.tsx`

Shown once per month, first app open after the season-reset worker runs:
- Full-screen confetti animation (lime and white)
- Final rank, peak territory, longest-held claim this season
- Hall of fame card if a record was broken
- Dismisses after 5 seconds or on tap → Turf map (now empty)
- Use `AsyncStorage` to track whether the current season's reset card has been shown

### 4.4 Claim Detail Sheet — Ghost Race Button
**File:** `apps/mobile/src/screens/TurfScreen.tsx`

When tapping a rival's territory polygon:
- Show claim detail sheet with speed-to-beat, perimeter, and duration
- "Ghost Race →" lime button that opens the Ghost Race confirmation sheet (see `screens.md` 1.4)
- Confirmation sheet shows the animated ghost silhouette, privacy note, and "Start Ghost Race" button
- On confirm: call `GET /territory/claims/:id/ghost-trace`, construct a `GhostRun` object, call `onGhostRace(run)` (prop already exists in `App.tsx`)

---

## 5. ML Implementation 🟠

The ML system is fully designed. See [`ml.md`](ml.md) for the complete specification. Not yet started.

### 5.1 Database migration
- Create `infra/postgres/migrations/044_ml_run_features.sql` (schema in `ml.md`)

### 5.2 Feature extractor worker
- Create `services/worker/src/ml-feature-extractor-job.ts`
- Reads `activity_submissions` within the 30-day retention window
- Extracts all 20 features listed in `ml.md` (no raw coordinates)
- Writes to `ml_run_features`

### 5.3 Anti-cheat microservice
- Create `services/ml/` directory with Python FastAPI app
- Create `services/ml/src/anticheat/train.py` — Isolation Forest training
- Create `services/ml/src/anticheat/server.py` — FastAPI inference endpoint
- Create `services/ml/src/anticheat/features.py` — feature extraction helpers

### 5.4 Quest recommendation microservice
- Create `services/ml/src/recommend/train.py` — Collaborative Filtering training
- Create `services/ml/src/recommend/server.py` — recommendation endpoint
- Integrate with `GET /quests/recommended`

### 5.5 Integration into territory claim route
- In `territory-claim-routes.ts`, after rule-based gates pass, call the ML `/score` endpoint
- If `ml_flagged = true`: hold claim for staff review, do not award territory yet
- Write `ml_anomaly_score` and `ml_model_version` back to `ml_run_features`

### 5.6 Monthly retrain worker
- Create `services/worker/src/ml-retrain-job.ts`
- Triggers model retraining on the 1st of each month
- Staff reviewer must promote the new model artifact before it goes live

---

## 6. Route Suggestion System 🟠

The curated routes schema (`041_curated_routes.sql`) is complete. The table ships empty. No API or mobile UI exists yet.

### 6.1 Seed curated route data
- The table `curated_routes` is empty. Needs human-reviewed MMR running loops.
- Each route needs: `name`, `path` (GeoJSON LineString, closed loop), `distance_metres`, `city_tag`, `surface`, `lit`, `traffic_exposure`, `accessibility`, `review_note`
- Minimum: 5–10 reviewed loops around Mumbai for launch
- This is a data task, not a code task

### 6.2 Route suggestion API endpoint
**File:** `services/api/src/route-suggestion-routes.ts` (create)

```
GET /routes/suggest?lat=...&lng=...&targetDistanceKm=...&targetMinutes=...
```
- Returns up to 3 published `curated_routes` nearest to the user's coarse location
- Ordered as Short / Medium / Long by `distance_metres`
- Filters: `status = 'published'`, `revalidate_before > now()`
- If `targetDistanceKm` provided: return the 3 routes closest in distance to that target
- If `targetMinutes` provided: convert to distance at 6 min/km default pace, then apply above
- Returns `no_curated_routes` if the table is empty or no published routes exist nearby

### 6.3 Route preview screen (mobile)
**File:** `apps/mobile/src/screens/RoutePreviewScreen.tsx` — already exists but may need the API wired in.

Verify:
- Calls `GET /routes/suggest` and displays the 3 cards
- Distance slider and time input controls update which card is highlighted
- "Use this route" → creates a `RouteGuide` and returns to `App.tsx` via `onUseRoute`

---

## 7. Documentation Fix — H3 Resolution Cell Size 🟠

`territory-guide.md` and `docs/README.md` Key Fact #10 both say **"resolution 11 (~15 m² per cell)"**. This is wrong.

H3 resolution 11 cells are approximately **1,963 m²** each (~15 m² is resolution 14).

The code uses resolution 11 (correctly — per the migration default). Only the documentation is wrong.

**Status: ✅ DONE (2026-09-12).** `docs/territory-guide.md` now states ~1,963 m²
with the 5,000 m² minimum spelled out as ~2.5 cells; `docs/README.md` Key Fact 13
already carried the correction. No doc cites ~15 m² any more.

This matters because a reviewer reading the docs will think the grid is 130× finer than it is, and will misunderstand the minimum carve area (5,000 m² = ~2.5 cells, not ~333 cells).

---

## 8. Gamification — Walking/Hiking References in Mobile Code 🟠

Product decision (2026-09-06): RunSphere is running-only. Migration 040 enforces this at the DB level. The following mobile files still contain walk/hike references:

| File | Change needed |
|------|---------------|
**Status: ✅ DONE (verified 2026-09-12).** Every file below was re-checked; the
only remaining occurrences of "walk"/"hike" anywhere in `apps/mobile/src` and
`packages/contracts/src` are comments recording *why* the types were removed.

| File | State |
|------|-------|
| `apps/mobile/src/screens/OnboardingScreen.tsx` | No activity-type selection; no walk/hike references |
| `apps/mobile/src/activity-flow.ts` | No walk/hike references |
| `apps/mobile/src/activity-recorder-core.ts` | Running-only; the sole mention is the explanatory comment |
| `apps/mobile/src/screens/ActivityScreens.tsx` | The hike safety cue is gone; a comment records its removal |
| `packages/contracts` | `ActivityCreateRequestSchema.movementType` is `Type.Literal('run')`; old values now return 400 |

A stale `'first-walk'` sample object in `achievements-model.test.ts` was renamed
to `'first-run'` — it was test fixture data only, asserted on by key not wording.

---

## 9. Known Gaps — Turf Mechanic 🔵

The Turf mechanic is implemented but has documented gaps with no resolution plan yet:

| Gap | Detail |
|-----|--------|
| No concentration guardrail | A single runner could theoretically hold all territory in a city. No cap or guardrail is designed yet. |
| Coordinated claim-trading | Two accounts can hand ground back and forth. No detection exists. |
| Privacy zone prompt | A user without a privacy zone set who runs near their home may expose their address via a territory claim. No auto-detection or onboarding prompt exists. |
| Not tested against real GPS | All tests use synthetic data. Real GPS traces are needed before the first public season. |

---

## 10. iOS v1.1 🟡

iOS work does not begin until Android v1 gates pass. Pending:
- Permission copy and denial behavior for iOS foreground location and optional motion.
- Encrypted offline queue, idempotent upload, GPS recovery (iOS).
- 200 m server-side trim and provenance on iOS-originated traces.
- iOS battery and distance field study.
- App Store privacy disclosures matching the actual collection/retention design.
- `expo-notifications` iOS configuration.

---

## 11. Admin Console — Incomplete Areas 🟡

| Area | Status |
|------|--------|
| Quest/place catalog & closure controls | Placeholder. Privacy review pending before implementing. |
| Quest availability map (staff view) | Not started. |
| Route suggestion path dataset management | Not started. |
| ML flag review queue | Not started. Required for Section 5 ML system. |

---

## 12. MMR Field Study 🟠

The following baselines are not yet frozen:
- GPS accepted-point cadence on real MMR devices
- Average trace size per run
- Upload retry rate
- Battery drain per hour of running
- Map/geocoding cache hit rate
- Quest recommendation acceptance and skip rates
- Route suggestion acceptance rates

**Action:** Conduct field study with ≥50 consenting pilot accounts over 4+ weeks. Do not use synthetic GPS as a substitute.

---

## DONE — Completed in 2026-09-07 Implementation

The following items from earlier versions of this document are now complete:

| Item | What was done |
|------|---------------|
| H3 library dependency | `h3-js@4.1.0` pinned in `packages/domain`. `H3_VERSION = '4.1.0'` constant in `h3-indexer.ts`. |
| Migration 036 (carving) | `h3_cell_set`, `h3_resolution`, `h3_version`, `parent_claim_id`, `season_month` added to `territory_claims`. GIN index created. Old duration-based constraint replaced with speed-based. |
| Domain carving functions | `runSpeed`, `effortGrace`, `graceAdjustedSpeed`, `h3CellSet`, `intersectCells`, `differenceCells`, `largestConnectedComponent`, `minCarveArea`, `assessCarve`, `carvingDecision` — all implemented in `packages/domain/src/territory-claim.ts`. |
| Migration 037 (monthly seasons) | `territory_claim_seasons`, `territory_claim_season_snapshots`, `territory_hall_of_fame` tables created. |
| Monthly season reset worker | `services/worker/src/territory-season-reset-job.ts` — state-driven, idempotent, atomic, self-healing. |
| Weekly rank worker | `services/worker/src/territory-rank-job.ts` |
| Territory snapshots worker | `services/worker/src/territory-claim-snapshots.ts` |
| Ghost Race domain | `packages/domain/src/ghost-race.ts` — `ghostTraceFrom` (200m trim), `ghostPositionAt` (interpolated), `ghostComparison` (distance-based), `ghostSecondsAtDistance`. |
| Migration 043 (Ghost Race DB) | `territory_claim_ghost_traces` and `territory_claim_ghost_views` tables. Rate limit of 3/hour enforced at DB level. |
| Migration 038 (geo tags) | `city_tag`, `country_tag`, `continent_tag` on `territory_claims`. H3 resolution 6 geocode cache seeded for MMR. |
| Geo-detection domain | `detectCityTag`, `territory-geo.ts` in `packages/domain`. |
| Geo-backfill worker | `services/worker/src/territory-geo-backfill.ts` — 2-pass cache-first, budget-limited geocode. |
| Migration 039 (email delivery) | Email delivery infrastructure. |
| Migration 040 (running-only + auto friend board) | `CHECK (movement_type = 'run')` constraint. Friends board opt-in rows revoked. |
| Migration 041 (curated routes) | `curated_routes` table with safety fields and review workflow. Ships empty. |
| Migration 042 (notification catalogue) | `notification_inbox` `dedupe_key` and all 12 notification kinds registered. |
| Notification catalogue (all 12 types) | `packages/domain/src/notification-catalogue.ts` — all 12 types with copy, privacy-safe `safeName()`, category mapping. |
| Season reset notification | Sends city rank (not global) and peak area (not final) per runner who held ground. |
| H3 Indexer | `packages/domain/src/h3-indexer.ts` — clean dependency inversion, `h3-js` is the only file that imports the library. |
| All 6 tabs wired in App.tsx | Turf, Home, Explore, Play, Clubs, You all render correctly. Ghost race and route guide state threaded through. |



---

## Priority Legend
- 🔴 **BLOCKER** — Android v1 cannot ship without this.
- 🟠 **IMPORTANT** — Required for a specific gated feature or user-facing quality.
- 🟡 **PLANNED** — Approved and in scope; not yet started.
- 🔵 **KNOWN GAP** — Known issue documented but no implementation decision taken yet.

---

## 1. Android v1 Launch Blockers 🔴

### 1.1 FCM (Push Notifications)
- Firebase project not created.
- `google-services.json` not added to `apps/mobile/android/`.
- `expo-notifications` not configured.
- Worker's FCM HTTP v1 sender has no service-account credentials.
- **Impact:** All push notifications (challenge results, friend requests, weekly resets) are silently dropped.

### 1.2 Email Provider
- No email provider configured in the worker or API.
- Campaign email and transactional email (password reset, email change alert) cannot be delivered.
- **Impact:** Campaign engine is complete but sends nothing.

### 1.3 Mascot Artwork
- Rho, Mira, Coda, Bram images do not exist in `apps/mobile/assets/`.
- `crew-assets.ts` references these paths but they return missing asset errors.
- Loop's image also needs production asset review.
- **Impact:** Mascot guidance callouts render broken or blank.

### 1.4 PostGIS Integration Tests (4 skipped)
- Four integration tests are marked skipped because local PostGIS is not running in CI.
- These cover privacy trimming, H3 traversal logic, and territory claim integration.
- **Action required:** Either run them in a Docker-based CI step or document them as manual-only.

### 1.5 Onboarding Screen — Remove Walk/Hike UI
- The onboarding screen currently shows Walk / Run / Hike activity type selection.
- Walking and hiking are removed from scope per product decision (2026-09-06).
- The activity selection step must be removed or replaced with a "running only" confirmation.
- **File:** `apps/mobile/src/screens/OnboardingScreen.tsx`

### 1.6 Friend Leaderboard — Remove Opt-In Toggle
- The friend standings board currently requires explicit opt-in per account.
- Product decision (2026-09-06): friend leaderboard is automatic — if you are mutual friends, you are on each other's board.
- **Files affected:**
  - `apps/mobile/src/screens/PlayScreen.tsx` (remove "join board" button)
  - `services/api/src/friend-standings.test.ts` (update test cases)
  - `services/api/src/gamification-routes.ts` (remove opt-in route / update logic)
  - `infra/postgres/migrations/019_friend_standings.sql` (opt-in column may need removal or deprecation)

---

## 2. Turf — H3 Carving + Monthly Season + Ghost Race 🔴

Turf is the primary feature. The TurfScreen.tsx UI and basic claim routes are built, but the new carving rules, monthly season, and Ghost Race are not yet implemented. See [`territory-guide.md`](territory-guide.md) for the full specification.

### 2.1 H3 library dependency
- Add `h3-js` (or equivalent) to `packages/domain` with a **pinned version**.
- Record version in `h3_version` column on every claim row.
- Required for H3 cell set computation and the `largestConnectedComponent` function.

### 2.2 Migration: `036_territory_claim_carving.sql`
Add to `territory_claims`:
- `perimeter_metres NUMERIC NOT NULL`
- `h3_resolution SMALLINT NOT NULL DEFAULT 11`
- `h3_cell_set TEXT[] NOT NULL`
- `h3_version TEXT NOT NULL`
- `parent_claim_id UUID REFERENCES territory_claims(id)`
- `season_month CHAR(7) NOT NULL`
- New event type `'carve'` in the territory events enum
- GIN index on `h3_cell_set` for fast overlap queries

### 2.3 Domain — new carving functions (`packages/domain/src/territory-claim.ts`)
Replace `claimOutcome` / `overlapRatio` with:
- `runSpeed(perimeterMetres, durationSeconds)` → m/s
- `effortGrace(challengerPerimetreMetres, holderPerimetreMetres)` → 0.0–0.15
- `graceAdjustedSpeed(baseSpeed, grace)` → effective speed
- `h3CellSet(ring, resolution, h3Indexer)` → string[]
- `intersectCells(a, b)` → string[]
- `differenceCells(a, remove)` → string[]
- `largestConnectedComponent(cells)` → string[] (largest H3-adjacent group)
- `minCarveArea(smallerClaimAreaSqm)` → number
- `carvingDecision(params)` → 'carve' | 'no_contest'

### 2.4 API — updated claim submission (`services/api/src/territory-claim-routes.ts`)
- Compute `perimeter_metres` at claim time from GPS trace
- Convert ring to H3 cells at resolution 11
- Query overlapping claims via PostgreSQL `h3_cell_set && $1` (GIN index)
- Run carving decision pipeline for each overlapping claim
- Apply `largestConnectedComponent` to surviving cells
- Write all changes in a single transaction
- Store `grace_applied`, `effort_ratio`, `effective_speed` in the carve event

### 2.5 Migration: `037_territory_seasons_monthly.sql`
New tables:
- `territory_seasons` (season_month, started_at, ended_at, reset_at)
- `territory_season_snapshots` (account_id, season_month, total_area_sqm, peak_area_sqm, rank)
- `territory_hall_of_fame` (record_type, value_sqm, account_id, season_month)

### 2.6 Worker — monthly season reset (`services/worker/src/territory-season-reset-job.ts`)
- Runs 00:01 IST on the 1st of each month
- Snapshots all active claims BEFORE reset
- Archives claims (`season_expired`), updates hall of fame
- Queues push notifications
- Idempotent — safe to run twice in the same month

### 2.7 Worker — weekly rank job (`services/worker/src/territory-rank-job.ts`)
- Runs every Monday 00:01 IST
- Computes total area per account in current season
- Writes weekly snapshot row

### 2.8 API — leaderboard endpoints (`services/api/src/territory-board-routes.ts`)
- `GET /territory/leaderboard/weekly`
- `GET /territory/leaderboard/monthly`
- `GET /territory/leaderboard/season/:month`
- `GET /territory/leaderboard/hall-of-fame`

### 2.9 Mobile — leaderboard tabs (`apps/mobile/src/screens/TurfScreen.tsx`)
- Tab switcher: This Week | This Season | All Time
- Season countdown banner
- Season reset full-screen card

### 2.10 Ghost Race — API (`services/api/src/territory-claim-routes.ts`)
- `GET /territory/claims/:id/ghost-trace` — returns trimmed, time-annotated GPS trace
- Rate-limited: 3 requests/user/hour
- Privacy: 200 m trim both ends, authenticated + same-region only, blocked users excluded

### 2.11 Ghost Race — Mobile (`apps/mobile/src/screens/ActivityScreens.tsx`)
- Accept `ghostTrace` + `claimId` props
- Render ghost as second `LineLayer` advancing by elapsed_seconds interpolation
- Live comparison card: `You: 3:42 in | Ghost: 3:51 in`
- Ghost Race button and confirmation modal in TurfScreen claim detail sheet

### 2.12 Geo-detection — Migration (`infra/postgres/migrations/038_territory_geo_tags.sql`)
Add to `territory_claims`:
- `city_tag TEXT NOT NULL` — e.g. `'Mumbai'`, `'New York'`, `'London'`
- `country_tag TEXT NOT NULL` — ISO 3166-1 alpha-2, e.g. `'IN'`, `'US'`, `'GB'`
- `continent_tag TEXT NOT NULL` — e.g. `'Asia'`, `'North America'`

### 2.13 Geo-detection — Domain (`packages/domain/src/territory-claim.ts`)
- `detectCityTag(lat, lng, geocodeCache)` — reverse geocodes claim centroid to city/country/continent tags
- Uses a cached H3-cell → city mapping (one geocode call per H3 cell, cached forever in DB)
- Must use coarse location only — not the exact GPS coordinates of the loop

### 2.14 Geo-detection — API (claim submission)
- At claim time: compute claim centroid → call `detectCityTag` → store tags on the claim row
- Geocoding is done via a cached Nominatim proxy — never the runner's exact GPS

### 2.15 Leaderboard endpoints — city/country/global
Add to `services/api/src/territory-board-routes.ts`:
- `GET /territory/leaderboard/city/:cityTag` — city standings (e.g. `/leaderboard/city/Mumbai`)
- `GET /territory/leaderboard/country/:countryCode` — country standings
- `GET /territory/leaderboard/global` — worldwide standings
- All return: rank, display name, mascot key, total m², season month

### 2.16 Mobile — leaderboard scope selector (`apps/mobile/src/screens/TurfScreen.tsx`)
- Leaderboard tab expands to: **My City | My Country | Global**
- Auto-detects and pre-selects the user's city tab based on their own claims' `city_tag`
- Global board shows top 50 only for privacy/scale reasons

---

## 3. Route Suggestion System (New Feature) 🟠

The route suggestion system does not yet exist. See [`product.md`](product.md#route-suggestions) for the specification.

### 2.1 API endpoint — route suggestion
- `GET /routes/suggest` (or equivalent)
- Accepts: coarse location, optional `targetDistanceKm`, optional `targetMinutes`.
- Returns: GeoJSON LineString loop + computed distance + estimated time.
- Must only use curated MMR public-path data.
- Must never suggest routes through unverified or private land.

### 2.2 Route data source
- A curated MMR running path dataset is needed.
- This is separate from the quest POI catalog.
- The dataset must be reviewed for safety (no routing through private land, unsafe roads).
- Data steward + review cadence must be assigned.

### 2.3 Route suggestion algorithm
- Generate up to 3 loop variants (short/medium/long) per request.
- Support `targetDistanceKm` adjustment (tighten or expand the loop).
- Support `targetMinutes` input → convert to distance at a default pace estimate.
- Minimum loop: 1 km. Maximum: 10 km.

### 2.4 Mobile — route preview map screen
- New screen or modal showing the suggested loop on the map before starting.
- Distance slider / time input controls.
- "Accept and Start" / "Start without route" buttons.
- See [`map-ux.md`](map-ux.md#2-route-suggestion-preview-map-before-starting-a-run) for full spec.

### 2.5 Mobile — live activity map
- Path trace polyline drawn in real time from local GPS points.
- Auto-follow camera (always centred on runner).
- Relocation button (re-centres when user has panned away).
- Zoom in / zoom out buttons.
- GPS quality indicator.
- Accepted route suggestion shown as a translucent static overlay.
- See [`map-ux.md`](map-ux.md#1-live-activity-map-during-a-run) for full spec.

---

## 3. Territory — H3 Cell Season Engine 🟠

The H3 season engine code is complete and tested in isolation but is switched off (`TERRITORY_CAPTURE_ENABLED = false`). Three things must happen before it can run:

### 3.1 H3 library dependency
- Add H3 (`h3-js` or equivalent) to `packages/domain` with a pinned version.
- Record the version, resolution, and algorithm version in the `CellIndexer` implementation.
- Required per ADR-0001 so contributions are always reproducible.

### 3.2 Public-space eligibility dataset
- A dataset of H3 cells in MMR that are verified public space (parks, promenades, public paths).
- Without this, the engine scores all cells — including private homes and offices.
- Must be reviewed, versioned, and stored with every season contribution.

### 3.3 Territory gate (release plan)
Before opening a season:
- Physical MMR field study (GPS quality, battery, distance — real devices, real paths).
- Eligible-cell capacity check: ≥10 eligible cells per target participant.
- Fair-scoring review (H3/privacy replay tests green).
- Concentration guardrail review (top-10%/top-user limits).
- Season rollback plan rehearsed.
- Pre-season cost forecast reviewed against the operating band.

---

## 4. Turf (Enclosure Claims) — Known Gaps 🔵

The Turf mechanic is live (shipped 2026-09-06) but has documented gaps:

| Gap | Status |
|-----|--------|
| No concentration guardrail | Not designed yet. A top-user cap equivalent to the H3 season's guardrail needs to be defined. |
| No coordinated claim-trading detection | Two accounts can hand ground back and forth. No pattern detection exists. |
| Home-address exposure for users without a privacy zone | The claim respects privacy zones, but only if the user has set one. Users who haven't are exposed. No auto-detection or prompt exists. |
| Not tested against a real database or real GPS traces | All tests use synthetic data. |

---

## 5. Admin Console — Incomplete Areas 🟡

| Area | Status |
|------|--------|
| Quest/place catalog & closure controls | Placeholder. Privacy review pending before implementing. |
| Quest availability map (staff view) | Not started. |
| Route suggestion path dataset management | Not started (new feature). |

---

## 6. iOS v1.1 🟡

iOS work does not begin until Android v1 gates pass. Pending:
- Permission copy and denial behavior for iOS foreground location and optional motion.
- Encrypted offline queue, idempotent upload, GPS recovery (iOS).
- 200 m server-side trim and provenance on iOS-originated traces.
- iOS battery and distance field study.
- App Store privacy disclosures matching the actual collection/retention design.
- `expo-notifications` iOS configuration.

---

## 7. Gamification — Walking and Hiking Removal 🟠

Product decision (2026-09-06): RunSphere is running-only.

Files that contain walking/hiking activity type references and need updating:

| File | Change needed |
|------|---------------|
| `apps/mobile/src/screens/OnboardingScreen.tsx` | Remove activity type selection (walk/hike options). |
| `apps/mobile/src/activity-flow.ts` | Remove or restrict activityType enum to `running` only. |
| `apps/mobile/src/activity-recorder-core.ts` | Remove walk/hike type handling if present. |
| `apps/mobile/src/screens/ActivityScreens.tsx` | Remove any walking/hiking UI branches. |
| `services/api/src/app.ts` | Remove walk/hike from any activity_type enums in schemas. |
| `packages/contracts` | Update activityType schemas — remove walk and hike values. |
| `packages/domain` | Verify no domain logic branches on activity type for scoring. |
| `infra/postgres/migrations` | If activity_type is stored as an enum column, migration needed to remove walk/hike. |

---

## 8. MMR Field Study (M1/M2 — Baseline Freeze) 🟠

The following baselines are not yet frozen — they are conservative initial estimates that must be validated with real field data:

- GPS accepted-point cadence on real MMR devices.
- Average trace size per run.
- Upload retry rate.
- Battery drain per hour of running.
- Map/geocoding cache hit rate.
- Quest recommendation acceptance and skip rates.
- Route suggestion acceptance rates.

**Action:** Conduct M1/M2 field study with ≥50 consenting pilot accounts over 4+ weeks. Freeze baselines after review. Record p50/p95 values. Do not use synthetic GPS as a substitute.

---

## 9. Cost Model Review 🟡

The ₹3,000/month green-band cost model uses estimated unit assumptions. Before public launch:
- Replace all estimated values with actual provider invoices.
- Verify production vs. staging cost centre tagging is working.
- Confirm 70%/85% budget alert routing to on-call channel is operational.
- Record the pre-season capacity forecast for territory processing before opening H3 enrollment.

---

## Removed / Archived

| Document | Reason |
|----------|--------|
| `docs/gamification-roadmap.md` | Superseded by `docs/gamification-detailed-plan.md` which contains the full milestone-by-milestone status. The roadmap was a planning artifact; the detailed plan is the live status document. |
