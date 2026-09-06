# Docs — Agent Onboarding Index

**If you are an agent starting work on this project, read the files in the order listed below.** Each file is one level deeper than the previous. Do not skip any file in the MUST READ list — they contain decisions that override common assumptions and are not obvious from the code alone.

---

## Product context (Read first — before touching any code)

| File | What it tells you | Time to read |
|------|-------------------|--------------|
| [`product.md`](product.md) | What the app is, who it is for, the full core loop, route suggestions, quests, territory summary, and all non-states the UI must handle | 10 min |
| [`gameplay.md`](gameplay.md) | All gamification rules: progression, challenges, clubs, leaderboards, territory, mascot guidance, mobile tab structure | 15 min |
| [`safety-and-privacy.md`](safety-and-privacy.md) | Every privacy invariant, consent model, location handling rule, social surface privacy guard, and safety contact design | 10 min |
| [`territory-guide.md`](territory-guide.md) | Plain-English step-by-step explanation of both territory mechanics (Turf enclosure claims and H3 cell seasons) | 8 min |
| [`map-ux.md`](map-ux.md) | Full spec for the live-run map (path trace, auto-follow, relocation button, zoom) and the route suggestion preview screen | 6 min |

## What is not done yet

| File | What it tells you |
|------|-------------------|
| [`pending-work.md`](pending-work.md) | Master list of all outstanding work — blockers, important items, planned features, known gaps, and specific files that need changing. **Read this before starting any new task.** |

## Architecture and infrastructure

| File | What it tells you |
|------|-------------------|
| [`architecture.md`](architecture.md) | Monorepo topology, service boundaries, data model summary, GPS quality rules, mapping policy, security posture |
| [`cost-model.md`](cost-model.md) | ₹3,000/month budget, approval bands, per-category caps, cost gates and fallback actions |
| [`release-plan.md`](release-plan.md) | Milestones (M0–M5), gamification rollout gates, Android v1 release gate table, iOS v1.1 gate, green push protocol |

## Design

| File | What it tells you |
|------|-------------------|
| [`design-reference.md`](design-reference.md) | What each approved design mockup obligates in implementation (the mockups themselves are in `docs/design/`) |

## Mascot / character system

| File | What it tells you |
|------|-------------------|
| [`mascot-storyline.md`](mascot-storyline.md) | Who the 5 mascot characters are and what product surface each covers |
| [`mascot-assets.md`](mascot-assets.md) | Technical asset spec — file paths, tone guardrails, `isSafeMascotLabel()` rules |

## Detailed implementation status

| File | What it tells you |
|------|-------------------|
| [`gamification-detailed-plan.md`](gamification-detailed-plan.md) | Full phase-by-phase status of every gamification milestone (Phase 1–5) — what is done, what is in progress, what is blocked |
| [`territory-field-study.md`](territory-field-study.md) | Field study protocol for GPS quality, battery, and distance baseline measurements |

## Architecture Decision Records (ADRs)

Each ADR is a permanent record of a specific decision. Read the relevant ADR when you are working in that feature area. **Do not contradict an ADR without creating a new one that explicitly supersedes it.**

| ADR | Decision |
|-----|----------|
| [`adr/0001-h3-territory-traversal.md`](adr/0001-h3-territory-traversal.md) | H3 hex grid, resolution, versioned algorithm |
| [`adr/0002-server-side-privacy-trimming.md`](adr/0002-server-side-privacy-trimming.md) | 200 m server-side trim with provenance record |
| [`adr/0003-synthetic-gps-test-mode.md`](adr/0003-synthetic-gps-test-mode.md) | Controlled synthetic GPS — cannot substitute field data |
| [`adr/0004-mmr-place-data.md`](adr/0004-mmr-place-data.md) | Curated MMR data, proxied Nominatim |
| [`adr/0005-pace-neutral-cosmetic-progression.md`](adr/0005-pace-neutral-cosmetic-progression.md) | XP and levels are cosmetic, never a gameplay advantage |
| [`adr/0006-weekly-periods-immutable-snapshots.md`](adr/0006-weekly-periods-immutable-snapshots.md) | Asia/Kolkata weekly periods; resets create immutable snapshots |
| [`adr/0007-opt-in-privacy-minimized-leaderboards.md`](adr/0007-opt-in-privacy-minimized-leaderboards.md) | Global boards are opt-in; friend board is automatic |
| [`adr/0008-seasonal-territory-weekly-resets.md`](adr/0008-seasonal-territory-weekly-resets.md) | H3 season rules — weekly ownership, capped control-days |
| [`adr/0009-durable-notifications-first.md`](adr/0009-durable-notifications-first.md) | Durable inbox first; defer Redis and WebSockets |
| [`adr/0010-cost-governance-approval-bands.md`](adr/0010-cost-governance-approval-bands.md) | Cost approval bands (green/amber/orange/red) |
| [`adr/0011-enclosure-territory-claims.md`](adr/0011-enclosure-territory-claims.md) | Turf mechanic — named holders, pace-based takeovers, reversal of ADR-0005 and ADR-0008 for this mechanic only |

---

## Key facts an agent must know before writing any code

1. **Activity type: running only.** Walking and hiking were removed from scope on 2026-09-06. Any code that branches on `activityType === 'walk'` or `'hike'` is outdated.

2. **Friend leaderboard is automatic.** Mutual friendship = automatic appearance on each other's weekly board. There is no opt-in toggle. Any UI or route that shows a "join board" button is outdated.

3. **Route suggestions are a new, unbuilt feature.** The system must generate loop shapes from curated MMR paths, let users tune distance/time before starting, and show a live path trace on the map during the run. No server endpoint exists yet.

4. **The server is always authoritative.** The client records locally and syncs. The client never awards XP, completes quests, scores territory, or finalizes any result. All of those happen server-side.

5. **No raw coordinates in analytics or logs.** Every query, log line, crash report, and analytics event must contain only derived data. Raw GPS is encrypted at rest and only accessible through the validated activity pipeline.

6. **Privacy zones are the runner's protection.** A 200 m geodesic radius around any saved private place. Server-side trimming — not a client-side visual obscuring. A Turf claim that touches a privacy zone is refused, not trimmed.

7. **Two territory mechanics — completely separate.** Turf (enclosure claims) is LIVE. H3 cell season engine is BUILT but SWITCHED OFF. They share no tables, no rules, and no feature flags.

8. **Cost budget is ₹3,000/month.** Any new feature that changes the infrastructure cost profile must include a cost estimate and the appropriate band owner approval before merging.

9. **The frequent green release protocol is mandatory.** Every change: narrow scope, proportionate tests, migration/rollback notes when data changes, feature flag for anything not yet broadly proven.

10. **Platform is MMR-only.** No other city or region is in scope. Expanding geography requires a separate safety, data, and cost review.
