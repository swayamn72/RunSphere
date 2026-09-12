# Territory Guide

**Last updated:** 2026-09-06 (v3 — includes finalized carving rules, monthly season, Ghost Race)
RunSphere has **two separate territory mechanics**. They share no tables, rules, or feature flags and are completely independent.

---

## Mechanic 1 — Turf (Enclosure Claims)
**Status: PRIMARY FEATURE. Live and active. Implementation underway (see pending-work.md).**

### What it is

Run a closed loop. The ground inside the loop becomes your claimed territory. Your display name and avatar appear on the map inside that area. When someone else runs through part of your area faster (accounting for effort), they carve out that portion.

This is the **centrepiece feature** of RunSphere.

---

### Step-by-step: how a claim works

**1. You go for a run.**
GPS records your path. The system detects the longest closed stretch in your trace — the widest-separated pair of GPS points that return within 60 m of each other.

**2. A loop is detected.**
The enclosed area becomes a candidate claim. Requirements:
- **Area:** 5,000 m² to 5 km² (bigger than a roundabout, smaller than what a car covers)
- **Duration:** only the closed-loop portion counts — warm-up before and cool-down after are excluded
- **Perimeter:** the total distance run around the loop is stored alongside the area. This is the key metric for all future contests.

**3. Claiming is explicit — tap to claim after the run.**
Your name and avatar are placed on the map. A run that is not claimed is just a run.

**4. H3 cell set is computed at claim time.**
The claim polygon is converted to a set of Uber H3 hexagonal cell indices at resolution 11 (~1,963 m² per cell — ~15 m² is resolution 14, so the 5,000 m² minimum claim is about 2.5 cells, not 333). The H3 library version is pinned and stored with the claim so every future computation is exactly reproducible.

**5. Claims are scoped to the current season month.**
Every claim belongs to the current month (e.g., `2026-09`). When the month ends, all claims expire and the map resets. See [Monthly Season Reset](#monthly-season-reset) below.

---

### How overlapping claims work (carving)

When a new loop overlaps an existing held claim:

**Step 1 — Find intersection using H3 cells.**
The intersection = set intersection of the two H3 cell sets. Fast O(n) lookup, no expensive polygon math. This is the "contested zone."

**Step 2 — Check minimum carve size.**
```
min_carve = max(5,000 m², 10% × smaller_claim_area)
```
If the intersection is smaller than this threshold → no contest (too insignificant to process).

**Step 3 — Compare speeds with effort-based grace.**

```
base_speed = perimeter_metres / duration_seconds  (metres per second)

effort_ratio = challenger_perimeter / holder_perimeter

grace = clamp(0%, (effort_ratio - 1.0) × 5%, 15%)
  effort_ratio 1.0× →  0% grace  (same size loop, no bonus)
  effort_ratio 2.0× →  5% grace
  effort_ratio 3.0× → 10% grace
  effort_ratio 4.0× → 15% grace  ← hard cap
  effort_ratio 5+×  → 15% grace  (cap stays)

effective_speed = challenger_base_speed × (1 + grace)
```

**Why grace?** A runner who ran a 4 km loop naturally runs at a slower per-metre pace than someone who ran a tight 1 km inner loop. Pure pace comparison would permanently disadvantage endurance runners. The grace factor acknowledges physical effort. The 15% hard cap ensures no one can jog a 50 km loop to take a sprinter's territory.

**Step 4 — Carving decision.**
```
If effective_speed > holder_speed → CARVE
If effective_speed ≤ holder_speed → NO CONTEST (holder keeps everything, tie goes to holder)
```

**Step 5 — Update both polygons.**
- Intersection H3 cells → challenger's new claim
- Remaining H3 cells from holder → holder's surviving claim
- `largestConnectedComponent()` is applied to the surviving cells to find the biggest connected group
- Disconnected smaller fragments are **dropped entirely** (not stored as separate claims)
- If the surviving area < 5,000 m² → holder loses the entire claim

**Step 6 — Atomic transaction.**
All database writes (carve event, new claim, updated claim, push notifications queued) happen in a single transaction. No partial states possible.

**Step 7 — Grace and decision details are stored in the carve event.**
`effort_ratio`, `grace_applied`, `effective_speed`, and `held_speed` are all recorded. Any disputed carve can be fully replayed from this data.

---

### Worked examples

```
═══════════════════════════════════════════════════════════════
Example A: Same loop size, challenger faster → CARVES
═══════════════════════════════════════════════════════════════
Holder:     1 km loop in 5:00 min → speed 3.33 m/s
Challenger: 1 km loop in 4:00 min → speed 4.17 m/s
effort_ratio = 1.0 → grace 0%
effective_speed 4.17 > 3.33 → CARVES ✓

═══════════════════════════════════════════════════════════════
Example B: Bigger loop, slightly slower pace → NO CONTEST
═══════════════════════════════════════════════════════════════
Holder:     1 km loop in 4:00 min → speed 4.17 m/s
Challenger: 3 km loop in 5:00/km  → speed 3.33 m/s
effort_ratio = 3.0 → grace 10%
effective_speed 3.33 × 1.10 = 3.66 < 4.17 → NO CONTEST

═══════════════════════════════════════════════════════════════
Example C: 4× bigger loop, decent pace → CARVES
═══════════════════════════════════════════════════════════════
Holder:     1 km loop in 4:30 min → speed 3.70 m/s
Challenger: 4 km loop in 5:00/km  → speed 3.33 m/s
effort_ratio = 4.0 → grace 15% (capped)
effective_speed 3.33 × 1.15 = 3.83 > 3.70 → CARVES ✓
(Challenger was 10% slower but ran 4× the distance)

═══════════════════════════════════════════════════════════════
Example D: Disconnected remainder after carve
═══════════════════════════════════════════════════════════════
Holder has a large L-shaped claim (30,000 m²).
Challenger carves a chunk from the middle, leaving two
disconnected pieces: 18,000 m² and 4,000 m².
largestConnectedComponent → 18,000 m² survives.
4,000 m² fragment is dropped (below 5,000 m² floor).
Holder's updated claim = 18,000 m².
```

---

### Monthly Season Reset

At **00:01 IST on the 1st of each month**:

1. Final leaderboard snapshot is taken (rank, total m², peak m²) — BEFORE the reset
2. All active claims change status to `season_expired`
3. The Turf map clears — every runner starts the new month with zero territory
4. Hall of fame is updated if any records were broken
5. Push notifications sent to all runners who held territory: "Season ended. You held X m² at peak. Rank #Z. New season starts now."

Claims are **never deleted** — the full history is always preserved. Expired claims can be viewed in season history. The live map only shows the current month's active claims.

**Weekly rank snapshots** also happen every Monday midnight IST, independent of the monthly reset. These record rank and area held at that moment within the current season.

---

### Ghost Race

When you tap a territory on the Turf map, you see the holder's name, area, and time to beat — plus a **Ghost Race** button.

Ghost Race lets you race against a ghost version of the holder's recorded run:
- The ghost advances along the holder's route at their original pace
- Your live GPS path trace grows on the same map alongside it
- A live comparison overlay shows: `You: 3:42 in | Ghost: 3:51 in`
- The ghost trace has 200 m privacy trimming applied from both ends

After the run, the server applies the **same carving algorithm** as any other run. Ghost Race is purely a motivational UI layer — the contest rules are identical. Rate limited to 3 ghost trace requests per user per hour.

---

### Privacy protections

- **Privacy zones:** If your loop comes within 200 m of a saved private place, the claim is refused entirely (not trimmed — a partial polygon is not a valid claim)
- **Ring rotation:** The H3 cell array is indexed from the westernmost cell, not from your start point. This prevents coordinate storage from revealing where you started (i.e., your home)
- **Sharing suspension:** Suspended accounts' claims disappear from the live map immediately
- **Display identity only:** The map shows your display name and mascot avatar — never email, contact details, or run history
- **Ghost trace:** Privacy-trimmed, rate-limited, only served to authenticated users in the same region who haven't been blocked by the holder

---

## Mechanic 2 — H3 Cell Season Engine
**Status: BUILT but SWITCHED OFF.**
Requires: H3 library dependency + public-space eligibility dataset + Territory gate in release plan.

### What it is

The city is divided into a hexagonal grid (H3 library). Each cell ≈ one city block. During a season, runners compete to **control cells by visiting them on the most days within a week**. Completely pace-neutral.

### Key concepts

**Best 60-minute window:** Each day, only your single best contiguous 60-minute stretch counts. Best = most distinct eligible cells covered. Contiguous = unbroken stretch, not hand-picked moments.

**Eligible cell:** Only H3 cells in verified public space (parks, promenades, public paths). Private homes and offices are excluded. This dataset does not exist yet — it is a blocker.

### Step-by-step: how a week works

```
Day 1 (Monday)
  You run 90 min. First 60 min → cells A,B,C,D,E. Last 30 min → F,G.
  Best window = first 60 min. Contribution: A,B,C,D,E.

Day 3 (Wednesday)
  You run again. Best window → cells B,C,E,F,G,H.

End of week (Sunday midnight IST)
  Worker snapshots: who controls each cell?
  Cell B: You — 2 days (Mon+Wed). Runner X — 1 day. You win.
  Cell F: Runner Y — 2 days. You — 1 day. Runner Y wins.
  Tie: Earliest accepted contribution timestamp wins.

  After snapshot → cells RESET to unclaimed.
  Season points carry forward.
```

### Why it is off

1. **No H3 library dependency** — version must be pinned (ADR-0001). Not yet in workspace.
2. **No public-space eligibility dataset** — without it, the engine scores runs through private homes.
3. **Territory gate not passed** — requires field study, fair-scoring review, concentration guardrail review, anti-abuse sign-off.

---

## Side-by-side Comparison

| | Turf (Enclosure) | H3 Season |
|---|---|---|
| Status | **Primary feature** | **Off (gated)** |
| Winning condition | Fastest effective speed (with effort grace) | Most days in a cell |
| Pace-neutral | Partially — grace helps endurance runners | Fully pace-neutral |
| Holder identity on map | Yes — name + avatar | No — anonymous cells |
| Reset cycle | Monthly (season reset) | Weekly cell reset |
| Feature flag | Always enabled | `TERRITORY_CAPTURE_ENABLED = false` |
| Overlap handling | H3-based carving with effort grace | N/A (cells are discrete, no overlap) |

ADR-0011 documents the deliberate reversals the Turf mechanic makes relative to the original pace-neutral, anonymous-cell design.


---

## Mechanic 1 — Turf (Enclosure Claims)
**Status: LIVE and active.**

### What it is

Run a closed loop. The ground inside the loop becomes your claimed territory. Your display name and avatar appear on the map inside that area. When someone else runs the same ground faster, they take it.

This is the **core, active** territory feature of RunSphere.

### Step-by-step: how a claim works

**1. You go for a run.**  
GPS records your path. The system looks for the longest closed stretch in your trace — the widest-separated pair of GPS points that return within 60 m of each other.

**2. A loop is detected.**  
The enclosed area becomes a candidate claim polygon. The system measures:
- **Area:** must be between 5,000 m² (bigger than a roundabout) and 5 km² (smaller than what a car could cover)
- **Duration:** the time taken to run just the closed loop portion. A warm-up jog before and a cool-down after do not count.

**3. Claiming is explicit — it does not happen automatically.**  
After the run, you tap "Claim this loop." Your name and avatar are placed on the map inside the polygon. A run that is not claimed is just a run.

**4. Someone else tries to take your territory.**  
They run a loop. The system checks overlap using a 32×32 grid sampling:
- Their loop must cover **≥60% of its own area** inside your existing claim for it to be a contest.
- If it does → they need to be **strictly faster** than your recorded time to take it.
- Equal time = you keep it (a tie is not a win for the challenger).
- Slower = you keep it.

**5. Takeover happens in a single atomic transaction.**  
The server decides the outcome. No race condition is possible — one request wins, the next sees the new holder and is evaluated against the new time.

**6. Claims are never deleted — only released.**  
The full takeover history (who held it, for how long, what time they set) is always preserved in the database.

### Privacy protections

- **Privacy zones apply.** If your loop comes within 200 m of one of your own saved private places (e.g. home), the claim is **refused entirely** — not trimmed. A polygon cannot be partially published.
- **Ring rotation.** The polygon's coordinate array is rotated to the westernmost point before storage. This prevents the array from revealing your start point (which on a loop from home would be your front door).
- **Sharing suspension.** If your account has a social suspension, your claims do not appear on the map and you cannot make new ones.
- **Display identity only.** The map shows your display name and avatar — never your email, contact details, or activity history.

### Current known gaps (not yet resolved — see pending-work.md)
- No protection for runners who have not set a privacy zone.
- No concentration guardrail (unlike the H3 season, there is no top-10% cap for Turf).
- No detection of coordinated claim-trading between accounts.
- Not yet tested against a real database with real GPS traces.

---

## Mechanic 2 — H3 Cell Season Engine
**Status: BUILT but SWITCHED OFF.**  
**Requires:** H3 library dependency + public-space eligibility dataset + Territory gate in release plan.

### What it is

The city is divided into a hexagonal grid (Uber H3 library). Each hexagon is roughly the size of a city block. During a season (6–8 weeks), runners compete to **control** cells by visiting them on the most days within the week.

This mechanic is **pace-neutral** — sprinting through a cell scores it exactly the same as running slowly through it.

### Key concepts

**Cell:** A hexagonal tile covering roughly one city block. Only cells in verified public space (parks, promenades, public paths) are eligible.

**Best 60-minute window:** Each day, only your single best contiguous 60-minute stretch of running counts. The "best" window = most distinct eligible cells. Ties → earliest start. It is always contiguous — you cannot hand-pick your best moments across a full day.

### Step-by-step: how a week works

```
Day 1 (Monday)
You run 90 min. First 60 min → cells A,B,C,D,E. Last 30 min → cells F,G.
Best window = first 60 min (5 cells > 2). Contribution: A,B,C,D,E.

Day 3 (Wednesday)
You run again. Best window → cells B,C,E,F,G,H.

End of week (Sunday midnight, Asia/Kolkata timezone)
Worker snapshots: who controls each cell?

Cell B: You — 2 days (Mon+Wed). Runner X — 1 day. You win.
Cell F: Runner Y — 2 days (Mon+Fri). You — 1 day. Runner Y wins.
Tie: Earliest accepted contribution timestamp wins.

After snapshot → cells RESET to unclaimed.
Your season POINTS carry forward.
```

### Season ladder

Control-days (days you controlled ≥1 cell) accumulate, capped per week, into season points. The cap is what makes the system pace-neutral at the season level — covering ground faster cannot earn more points per hour.

### What the map shows

- Held vs. unclaimed cells in your division.
- Your own held cells (highlighted).
- **Other people's cells show no identity** — only whether a cell is held or not. This is a deliberate privacy decision (a territory position reveals where someone physically ran).
- Your own standing: rank + points. Other ladder entries are anonymous.

### Divisions

Assigned at enrollment from activity-history bands (not pace, not location). You cannot reroll. Rebalancing between seasons only.

### Why it is off

1. **No H3 library dependency** — version must be pinned per ADR-0001 so contributions are reproducible. Not yet added to the workspace.
2. **No public-space eligibility dataset** — without it the engine would score people for running through their living room.
3. **Territory gate not passed** — requires a physical MMR field study, fair-scoring review, concentration monitoring, and anti-abuse sign-off.

---

## Side-by-side Comparison

| | Turf (Enclosure) | H3 Season |
|---|---|---|
| Status | **Live** | **Off (gated)** |
| Winning condition | Fastest time | Most days in a cell |
| Pace-neutral | No — speed wins | Yes — pace doesn't affect cell value |
| Holder identity on map | Yes — name + avatar | No — anonymous cells |
| Reset cycle | No reset (taken by faster runner) | Weekly reset |
| Feature flag | Always enabled | `TERRITORY_CAPTURE_ENABLED = false` |

ADR-0011 documents the deliberate reversals the Turf mechanic makes relative to the original pace-neutral, anonymous-cell design.
