# Pending Work

**Last updated:** 2026-09-06 (v4 — global territory scope, city/country leaderboards added)
This document is the single source of truth for what work is not yet done. An agent starting a new task should read this file first and update it as work is completed.

> [!IMPORTANT]
> **Geographic scope change (2026-09-06):** Territory claims now work globally — any runner anywhere can claim ground. Leaderboards are city-scoped, country-scoped, and global. This is a product decision. The pending work in Section 2 reflects this. Quest data and route suggestions remain MMR-only for launch (requires curated datasets per city before expanding).


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
