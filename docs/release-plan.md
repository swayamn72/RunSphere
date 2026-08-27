# Release plan and quality gates

## Delivery principles

- **Android v1** is the launch platform; **iOS v1.1** is not a simultaneous Android v1 dependency.
- The launch geography is MMR only. New geographies require a separate data, safety, and cost readiness review.
- Release **small, frequent green changes** behind flags. “Green” means required automated checks pass, the staged health check is clean, and no unresolved blocker is waived.
- Field baselines are measured first and frozen only after the sample/quality criteria in the product and architecture documents are met.

## Milestones

| Milestone                                | Outcome                                                                                                | Key exit criteria                                                                                                                                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M0 — Rulebook and foundations            | Product, privacy, architecture, ADRs, metrics/event schema, and MMR data contract agreed               | This documentation reviewed; no Android v1 or iOS v1.1 behavior contradicts approved decisions or design traceability.                                                                         |
| M1 — Android v1 private-pilot foundation | Account eligibility, consent, local activity queue, server ingestion, validated/private saved activity | 18+ assertion; foreground location decline path; optional motion permission path; 200 m server trim; provenance; crash coordinate scrubber; offline reconciliation; gated synthetic test mode. |
| M2 — Android v1 quest pilot              | Curated MMR quest supply and adaptive recommendations                                                  | POI/checkpoint provenance; closed/unavailable state; initial adaptation telemetry; field GPS/distance/battery study started; quest completion not dependent on photos.                         |
| M3 — Android v1 territory pilot          | Optional 6–8 week season, enrollment and divisions                                                     | No-season and non-enrolled UI states; server H3 traversal; best-60-minute rule; fairness/concentration monitoring; security and abuse review; season rollback plan.                            |
| M4 — Android v1 launch                   | MMR public Android release                                                                             | Android v1 gate table passes; baseline-freeze decisions documented; cost forecast ≤₹3,000/month; operational runbook and support flow approved.                                                |
| M5 — iOS v1.1                            | iOS parity for approved v1 capabilities                                                                | iOS v1.1 gate table passes independently; permission, background behavior, privacy trim, offline/reconciliation, and season scoring parity verified.                                           |

## Android v1 release gate

| Gate                    | Acceptance condition                                                                                                                                             |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product                 | Walk/run/hike activity, free activity, adaptive quest flow, and explicit quest unavailable state function in MMR. No photo upload UI/endpoint is enabled.        |
| Eligibility and consent | Age assertion is mandatory; foreground location permission is requestable in context; denied location and denied optional motion paths are usable and tested.    |
| Privacy                 | 200 m privacy zones are trimmed server-side; provenance record is written; exports/shares do not reveal trimmed geometry; crash reports are coordinate-scrubbed. |
| Safety                  | Safety contacts use symmetric terms; delayed coarse sharing is opt-in, visibly delayed, capped, and revocable; no emergency-service claim.                       |
| Activity quality        | Field study meets or explicitly revises the distance and battery freeze criteria in [architecture](architecture.md#gps-quality-load-and-distance-baselines).     |
| Territory               | Only launch if M3 fair-scoring, division, concentration, and anti-abuse review are green. Otherwise ship quests without a season.                                |
| Data                    | Published MMR catalog has reviewed provenance, checkpoint geometry, freshness, and closure handling.                                                             |
| Operations              | Monthly forecast and observed steady-state spend are ≤₹3,000; alerts, restore test, deletion workflow, and support escalation are exercised.                     |
| Reliability             | Automated unit/integration checks, staging smoke test, and production canary health checks are green; rollback is rehearsed.                                     |

## iOS v1.1 release gate

iOS is not enabled merely because Android is live. Before iOS v1.1, verify all Android product rules on supported iOS versions and devices, including:

1. foreground location and optional motion/fitness consent copy and denial behavior;
2. encrypted offline queue, idempotent upload, processing reconciliation, and GPS recovery;
3. 200 m server-side trim and provenance on iOS-originated traces;
4. same server-side checkpoint, H3, best-60-minute, division, and privacy outcomes for equivalent accepted traces;
5. delayed/coarse/revocable safety sharing and coordinate-scrubbed crash reporting;
6. iOS battery and distance field-study results meeting the frozen target or a documented, reviewed platform-specific replacement;
7. App Store privacy disclosures matching the actual collection/retention design;
8. cumulative operating forecast remaining within ₹3,000/month, or a separately approved budget change.

## Frequent green push protocol

Each small release should include a narrow change, tests proportionate to the changed boundary, migration/rollback notes when data changes, and a feature flag for behavior that is not yet broadly proven. Promote through local/CI checks, staging smoke, a canary cohort, then rollout. Automatically halt rollout on a material increase in crashes, activity-validation failures, trim failures, or cost rate. Do not bundle a new scoring policy with a large client release when it can be configured and observed independently.
