# ADR-0008: Seasonal territory — weekly ownership rounds and capped control-days

- **Status:** Accepted
- **Date:** 2026-08-28

## Context

ADR-0001 committed to H3 indexes and the best-contiguous-60-minute window. The
season format still needs rules for weekly ownership, caps, and leaderboards
that do not reward faster traversal or raw cell volume.

## Decision

Territory is an opt-in 6–8 week MMR season with a fixed H3 resolution and
public-space eligibility. Participants are isolated by division. Each local
calendar day selects the best contiguous 60 minutes of validated eligible
traversal by maximum eligible cell contribution, breaking ties by earliest
start.

A participant can contribute at most once per cell per local day, up to a
published daily eligible-cell cap. Season ladder points use capped control-days
rather than uncapped cell volume. Weekly cell control is recomputed from the
final accepted contribution set for immutable snapshot version N; ties use
earliest accepted contribution, then a stable opaque participant ID only as a
reproducibility fallback. Upload or worker order never decides control.

Cells reset to unclaimed each week while season points and cosmetic ladder
progress continue. Other participants' map cells expose no route, timestamp,
exact start/finish, or owner identity.

## Consequences

- H3 indexes are stored as strings with pinned H3 library, resolution,
  algorithm, privacy-policy, and scoring-rule versions.
- Daily caps and control-days prevent faster movement from sweeping more ladder
  points per hour.
- Weekly snapshots are auditable and reversible without rewriting history.
- Territory remains disabled until the Territory gate in the release plan
  passes.
