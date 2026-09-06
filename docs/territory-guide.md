# Territory Guide

**Last updated:** 2026-09-06  
RunSphere has **two separate territory mechanics**. They share no tables, rules, or feature flags and are completely independent of each other.

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
