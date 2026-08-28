# ADR-0007: Opt-in, privacy-minimized leaderboards

- **Status:** Accepted
- **Date:** 2026-08-28

## Context

Leaderboards are where location, activity, and social data can leak. The
product wanted broad boards but the privacy constraints require explicit,
revocable scopes.

## Decision

Leaderboards use explicit scopes and immutable periods. The global board is
opt-in only, off by default, and separately revocable. It ranks only published
server-derived pace-neutral scores and may be segmented by cohort/division when
fairness, scale, eligibility, or newcomer treatment require it.

A public entry exposes only an approved display identity/cosmetic, score, tier,
rank band or numeric rank where allowed, and period. It never exposes location,
route, activity timestamps or details, or live state. Friend boards and club
boards use independent visibility controls; club boards are isolated by
`club_id`. Competition and territory scopes are visible only to enrolled
participants.

## Consequences

- No nearby-runner or location-based discovery is built.
- Global and numeric ranks appear only after explicit opt-in.
- Privacy-minimized projections are defined once in the contracts package and
  reused by every read path.
