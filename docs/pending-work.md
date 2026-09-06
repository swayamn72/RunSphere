# Pending Work

**Last updated:** 2026-09-06  
This document is the single source of truth for what work is not yet done. An agent starting a new task should read this file first and update it as work is completed.

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

## 2. Route Suggestion System (New Feature) 🟠

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
