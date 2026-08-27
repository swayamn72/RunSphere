# ADR-0001: H3 territory traversal

- **Status:** Accepted
- **Date:** 2026-08-27

## Context

Optional territory seasons need a cell model that supports MMR-scale aggregation, privacy-safe displays, fair pace-neutral scoring, and reproducible server validation. The product design uses hexagonal territory imagery.

## Decision

Use H3 indexes as the canonical territory cell identifier. The server derives traversed cells from accepted, timestamped GPS segments after privacy and quality policy evaluation. It stores the H3 library/version, resolution, segment-to-cell algorithm version, and scoring-rule version with the contribution.

The server selects a participant’s best contiguous 60-minute local-day window by maximum eligible cell contribution. One eligible cell has the same base value regardless of activity type or pace. Division, enrollment, and season boundaries are applied before aggregate ranks are generated. Client estimates are informational only and cannot award territory.

Cell resolution and eligible season polygons are configuration values selected from field tests for safety, density, and reachable public space. They are frozen for a live season; changing either starts a new season or requires a published remediation policy.

## Consequences

- H3 gives stable, compact indexes and hex aggregation for maps and leaderboards.
- The implementation needs deterministic boundary/timestamp tests and field checks for urban GPS behavior.
- H3 cells are aggregates, not proof that a person visited a particular address. Territory displays must not expose raw traversal or live position.
- Anti-spoof and GPS quality checks are server-side. A failed validation returns an explanation, not a speed-based penalty.
