# Product and gameplay rulebook

**Status:** Approved product decisions for v1 / v1.1 planning and the gamified expansion
**Market:** Mumbai Metropolitan Region (MMR)  
**Audience:** Adults only (18+)

The gamification expansion — progression, achievements, weekly consistency,
friend challenges, clubs, opt-in leaderboards, scheduled competitions, and
territory — is codified in [`gameplay.md`](gameplay.md). This document retains
the core loop, quests, and the summary of territory seasons; the full season
rules live in [ADR-0008](adr/0008-seasonal-territory-weekly-resets.md).

## Product promise

RunSphere makes outdoor movement feel exploratory rather than performance-driven. Its first-class activity types are **walking, running, and hiking**. A person can complete the main loop at any pace; speed is not a prerequisite for progress, recommendations, or territory scoring.

The approved visual direction is documented in the supplied mobile artifacts, notably [onboarding](design/onboarding-welcome-default.html), [quest discovery](design/quest-discovery-default.html), [live activity](design/live-activity-default.html), and [territory](design/territory-season-default.html). See [design traceability](design-reference.md) for implementation obligations beyond the mockups.

## Entry, eligibility, and primary loop

1. A person creates an account and makes an **18+ age assertion**. The assertion records that the person is eligible, when it was made, and the policy version; it does not collect a date of birth in v1.
2. They select walking, running, or hiking and optional accessibility preferences.
3. They grant foreground precise-location permission to record an activity. Motion/fitness permission is separately requested and optional.
4. They choose an available quest, or start a free activity. The activity records locally first and can finish offline.
5. The server validates the submitted trace, awards eligible quest/cell progress, and produces a privacy-safe saved route and summary.
6. The next recommendation learns from completed, skipped, and declined quests without treating pace as a quality signal.

### Explicit non-states

The app must not imply that a season is always available or that every account participates.

| State                                | Required UI and behavior                                                                                                                                                                |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Before first territory season        | Play tab explains that seasons are not yet live, shows the next announced window only when confirmed, and links to quest discovery. No rank, map ownership, or placeholder leaderboard. |
| Season live, not enrolled            | Show rules, division assignment explanation, an explicit **Join season** action, and a quest-first alternative. Do not calculate or display a rank.                                     |
| Enrolled but no qualifying time      | Show `0 qualifying minutes today`, explain the daily best-60-minute cap, and invite any pace activity.                                                                                  |
| No nearby eligible quest / POI issue | Explain why the quest is unavailable, offer a free activity and nearby verified alternatives. Never auto-complete a POI-dependent checkpoint from proximity to an unverified place.     |
| Offline                              | Continue local recording; mark quest and cell results pending server validation and do not present them as final.                                                                       |

## Hybrid adaptive quests

A quest is a time-bounded, route-flexible outdoor objective made of one or more checkpoints. The system combines:

- **Curated supply:** verified MMR parks, promenades, trailheads, landmarks, public paths, accessibility facts, hours, and closures.
- **Adaptive ordering and composition:** ranks safe, open, reachable quests and can vary checkpoint sequence, distance band, time window, and movement-friendly language.

The system never adapts by demanding a faster pace. It should prefer a feasible activity over an ambitious one when the person has high recent load, limited time, declining engagement, inaccessible routing, poor weather, or low GPS confidence.

### Quest eligibility and POI dependency

Every quest checkpoint must have a stable `checkpoint_id`, a versioned geographic geometry, and a data provenance record. A checkpoint is one of:

1. **Place-backed:** links to a verified POI version and requires its operating/accessibility status to be valid.
2. **Route-backed:** links to a reviewed public-path segment or geographic corridor.
3. **Area-backed:** is a reviewed public open-space polygon and has no claim about a specific amenity.

The server, not the client, evaluates a checkpoint against the accepted trace. If a POI is closed, removed, unverified, or its geometry changes materially, affected quests are unpublished or regenerated; they do not silently remain completable. A v1 quest cannot require an uploaded photo, manual photo evidence, or computer vision. **Photo uploads are out of scope for v1.**

### Initial adaptive-policy baselines

These are conservative initial operating values, not assertions of field performance. They must be instrumented in Milestone 1 and **frozen only after the MMR field study** defined below.

| Guardrail                            | Initial baseline                                                                                                                                                                          | Freeze rule                                                                                                 |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Recommendation daily volume          | At most 3 actionable recommendations per person per local day                                                                                                                             | Freeze after 4 weeks with ≥50 consenting pilot accounts and a reviewed opt-out/skip rate.                   |
| Distance bands                       | 0.5–2 km, 2–5 km, 5–10 km; default new-user recommendation 0.5–2 km                                                                                                                       | Freeze per movement type after 150 completed valid activities or 6 weeks, whichever is later.               |
| Recommended travel distance to start | ≤1.5 km walking distance from current coarse location; otherwise offer browse/free activity                                                                                               | Freeze after comparing acceptance and start abandonment across ≥100 impressions.                            |
| Adaptation inputs                    | Last 7 days’ active minutes, selected movement/accessibility settings, completion/skip feedback, verified opening status, weather severity, and coarse availability; **not** pace ranking | Freeze input set after privacy review and pilot audit; any new signal requires ADR review.                  |
| High-load fallback                   | If 7-day active minutes are ≥150% of the person’s trailing 28-day weekly median, prefer a shorter/optional recovery quest; never prescribe health advice                                  | Freeze threshold after pilot distribution review; retain manual “show more options.”                        |
| POI freshness                        | Revalidate volatile hours/closure data every 30 days; immediately unpublish on confirmed closure report                                                                                   | Freeze only after city data steward validates 95% of sampled records; until then use staff-reviewed subset. |

## Territory seasons

Territory is an **optional** competitive mode. Seasons run for a published 6–8 week period, begin only after operations approval, and use the H3 traversal model in [ADR-0001](adr/0001-h3-territory-traversal.md).

### Fair scoring

- A qualifying activity creates eligible traversal only after server validation.
- For each person and local calendar day, only their **best contiguous 60 minutes** of validated eligible traversal may contribute to territory scoring. “Best” means the window with the greatest eligible cell contribution under the published rule, not the fastest pace or longest distance.
- Walking, running, and hiking may all qualify. The same accepted traversal rule applies to each; pace, heart rate, calorie estimate, and speed do not change a cell’s value.
- Time outside the best 60-minute window can remain in the person’s private activity history but adds no territory score that day.
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

Product telemetry measures system safety and usefulness, not athletic worth. Initial metrics include quest impressions, starts, completions, skips, checkpoint failures, offline reconciliation, GPS rejection reasons, season enrollment, qualifying-minute distribution, division concentration, and safety feature use. Event schemas exclude raw coordinates unless an activity-submission workflow requires them; analytics receives coarse aggregates or derived counters.

Adaptive changes are released behind a server-controlled configuration with an audit trail: rule version, input schema version, and rollout percentage. The default is **baseline, measure, review, then freeze**—not continuous opaque experimentation.
