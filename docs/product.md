# Product and gameplay rulebook

**Status:** Approved product decisions for v1 / v1.1 planning and the gamified expansion
**Launch market:** Mumbai Metropolitan Region (MMR) — Android v1 first market  
**Geographic scope:** Global — territory can be claimed anywhere in the world; leaderboards are city-scoped, country-scoped, and global  
**Audience:** Adults only (18+)

The gamification expansion — progression, achievements, weekly consistency,
friend challenges, clubs, leaderboards, scheduled competitions, and
territory — is codified in [`gameplay.md`](gameplay.md). This document retains
the core loop, route suggestions, quests, and the summary of territory seasons;
the full season rules live in [ADR-0008](adr/0008-seasonal-territory-weekly-resets.md).

## Product promise

RunSphere makes outdoor movement feel exploratory rather than performance-driven. Its first-class and only activity type is **running**. Walking and hiking are out of scope for v1 and beyond — the platform is a running-first product. All route suggestions, quest checkpoints, scoring, and territory mechanics are designed for runners.

The approved visual direction is documented in the supplied mobile artifacts, notably [onboarding](design/onboarding-welcome-default.html), [quest discovery](design/quest-discovery-default.html), [live activity](design/live-activity-default.html), and [territory](design/territory-season-default.html). See [design traceability](design-reference.md) for implementation obligations beyond the mockups.

## Entry, eligibility, and primary loop

1. A person creates an account and makes an **18+ age assertion**. The assertion records that the person is eligible, when it was made, and the policy version; it does not collect a date of birth in v1.
2. They grant foreground precise-location permission to record an activity. Motion/fitness permission is separately requested and optional.
3. They choose a suggested route or start a free run. The activity records locally first and can finish offline.
4. The server validates the submitted trace, awards eligible quest/cell progress, and produces a privacy-safe saved route and summary.
5. The next route suggestion learns from completed, skipped, and declined runs, without treating pace as a quality signal.

### Explicit non-states

The app must not imply that a season is always available or that every account participate| State                                | Required UI and behavior                                                                                                                                                                |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Before first territory season        | Turf tab shows empty map; no rank, no ownership. Banner: "Season starts on [date] — start running to claim ground." |
| Season live, not enrolled            | Show rules, auto-enrolled status for friend standings, and a run-first alternative. Do not calculate or display a rank.                               |
| Enrolled but no qualifying time      | Show `0 qualifying minutes today`, explain the daily best-60-minute cap, and invite any run.                                                                                            |
| No nearby eligible quest / POI issue | Explain why the quest is unavailable, offer a free run and nearby verified alternatives. Never auto-complete a POI-dependent checkpoint from proximity to an unverified place.          |
| Offline                              | Continue local recording; mark quest and cell results pending server validation and do not present them as final.                                                                       |
| User is outside any city with active runners | Show empty Turf map. Allow claiming (claims work globally). Show their city's leaderboard once they make their first claim. No "territory unavailable" message — territory is available everywhere. |     |

## Route suggestions

A route suggestion is a server-generated running loop shown on the map before a run starts. The system generates a loop shape (a visible polygon/path) around the user's current location using curated public MMR paths. The user can interact with the suggestion before starting:

- **Reduce total distance** — the system tightens the loop to a shorter version.
- **Reduce total estimated time** — the system recalculates a shorter loop targeting the requested time.
- **Accept and run** — the route is shown as a reference overlay on the map during the run. The user is not forced to follow it exactly; it is a guide, not a turn-by-turn instruction.

The system generates route suggestions using curated MMR public paths, so the shapes it proposes are safe, publicly accessible, and verified. It never suggests routes through unverified or private land.

The suggestion engine learns from the user's recent history:
- Recent run distances and durations.
- Completed, skipped, and declined past suggestions.
- Time of day and typical availability patterns.
- High-load fallback: if recent run load is high, prefer a shorter suggestion.

The system never adapts by demanding faster pace. A shorter suggestion is always the response to high load or a user's time request — never a pace target.

### Suggestion guardrails

| Guardrail | Baseline |
| --- | --- |
| Suggestions per session | At most 3 route options shown at once |
| Distance range | 1–10 km; default new-user suggestion 2–4 km |
| High-load fallback | If 7-day active minutes ≥150% of the person's trailing 28-day weekly median, default to shortest option |
| User distance adjustment | Can reduce (or increase, up to a cap) from the suggestion; minimum loop is 1 km |
| User time adjustment | Can request a target time (e.g. "30 minutes"); system recalculates distance at typical pace estimate |

## Quests

A quest is a time-bounded running objective made of one or more checkpoints at real verified MMR locations. The system combines:

- **Curated supply:** verified MMR parks, promenades, landmarks, public paths, operating hours, and closure data.
- **Adaptive ordering:** ranks safe, open, reachable quests and can vary checkpoint sequence and distance band.

The system never adapts by demanding a faster pace. It should prefer a feasible run over an ambitious one when the person has high recent load, limited time, declining engagement, poor weather, or low GPS confidence.

### Quest eligibility and POI dependency

Every quest checkpoint must have a stable `checkpoint_id`, a versioned geographic geometry, and a data provenance record. A checkpoint is one of:

1. **Place-backed:** links to a verified POI version and requires its operating/accessibility status to be valid.
2. **Route-backed:** links to a reviewed public-path segment or geographic corridor.
3. **Area-backed:** is a reviewed public open-space polygon and has no claim about a specific amenity.

The server, not the client, evaluates a checkpoint against the accepted trace. If a POI is closed, removed, unverified, or its geometry changes materially, affected quests are unpublished or regenerated; they do not silently remain completable. A v1 quest cannot require an uploaded photo, manual photo evidence, or computer vision. **Photo uploads are out of scope for v1.**

### Initial adaptive-policy baselines

These are conservative initial operating values, not assertions of field performance. They must be instrumented in Milestone 1 and **frozen only after the MMR field study**.

| Guardrail | Initial baseline | Freeze rule |
| --- | --- | --- |
| Quest recommendation volume | At most 3 actionable quests per person per local day | Freeze after 4 weeks with ≥50 consenting pilot accounts and a reviewed opt-out/skip rate. |
| Distance bands | 1–3 km, 3–6 km, 6–10 km | Freeze per run type after 150 completed valid runs or 6 weeks, whichever is later. |
| Recommended travel distance to start | ≤1.5 km from current coarse location | Freeze after comparing acceptance and start abandonment across ≥100 impressions. |
| Adaptation inputs | Last 7 days' active minutes, completion/skip feedback, verified opening status, weather severity, and coarse availability; **not** pace ranking | Freeze input set after privacy review and pilot audit. |
| High-load fallback | If 7-day active minutes are ≥150% of the trailing 28-day weekly median, prefer a shorter route suggestion | Freeze threshold after pilot distribution review. |
| POI freshness | Revalidate volatile hours/closure data every 30 days; immediately unpublish on confirmed closure report | Freeze only after city data steward validates 95% of sampled records. |

## Territory seasons

Territory is an **optional** competitive mode for runners. Seasons run for a published 6–8 week period, begin only after operations approval, and use the H3 traversal model in [ADR-0001](adr/0001-h3-territory-traversal.md).

See [`territory-guide.md`](territory-guide.md) for a plain-English explanation of both territory mechanics (H3 cell seasons and Turf enclosure claims).

### Fair scoring

- A qualifying run creates eligible traversal only after server validation.
- For each person and local calendar day, only their **best contiguous 60 minutes** of validated eligible traversal may contribute to territory scoring. "Best" means the window with the greatest eligible cell contribution under the published rule, not the fastest pace or longest distance.
- Pace, heart rate, calorie estimate, and speed do not change a cell's value.
- Time outside the best 60-minute window can remain in the person's private run history but adds no territory score that day.
- A minimum quality requirement applies equally to all: GPS samples must satisfy the published accuracy, continuity, and anti-spoof checks. Failure produces a non-punitive “not eligible for territory” result with a reason.
- No individual live location, raw trace, or exact start/finish is exposed by territory maps or leaderboards.
- A participant contributes at most once per cell per local day, up to a published daily eligible-cell cap. Season ladder points use capped control-days, not uncapped cell volume.
- Cells reset to unclaimed each week while season points and cosmetic ladder progress continue. Weekly cell control is recomputed into immutable snapshots; upload or worker order never decides control. See [ADR-0008](adr/0008-seasonal-territory-weekly-resets.md).

### Divisions and winner concentration

Participants are assigned to a division at enrollment using a published, privacy-preserving activity-history band; new participants enter a newcomer division. Divisions are isolated for rank and awards. Rebalancing is permitted between seasons only, never mid-season.

| Guardrail            | Initial baseline                                                                                                                                         | Freeze rule                                                                                                                                                            |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Division size        | Target 100–250 enrolled participants; merge only below 40; split above 300 at season start                                                               | Freeze after first completed season with at least 3 viable divisions.                                                                                                  |
| Newcomer treatment   | First territory season is newcomer-only when ≥40 new entrants are available; otherwise a clearly labeled mixed division                                  | Freeze after season-one enrollment review.                                                                                                                             |
| Winner concentration | In any division, the top 10% should hold no more than 35% of cumulative territory points; the top 1 participant no more than 8%                          | Monitor daily. If breached for 7 consecutive days, pause awards analysis and investigate cell scarcity/validation abuse before next release. Freeze after two seasons. |
| Cell scarcity        | No launch area is eligible unless its reachable public cell inventory supports a modeled 10 distinct cells per enrolled participant at target enrollment | Freeze after field traversal validation and capacity simulation.                                                                                                       |

The pre-season rules screen must state the date, duration, qualifying rule, division, privacy treatment, and reward type. Rewards are cosmetic/status only in v1; no cash, physical prizes, or paid advantage.

## Measurement and experimentation

Product telemetry measures system safety and usefulness, not athletic worth. Initial metrics include route suggestion impressions, distance/time adjustments, quest impressions, starts, completions, skips, checkpoint failures, offline reconciliation, GPS rejection reasons, season enrollment, qualifying-minute distribution, division concentration, and safety feature use. Event schemas exclude raw coordinates unless an activity-submission workflow requires them; analytics receives coarse aggregates or derived counters.

Adaptive changes are released behind a server-controlled configuration with an audit trail: rule version, input schema version, and rollout percentage. The default is **baseline, measure, review, then freeze**—not continuous opaque experimentation.
