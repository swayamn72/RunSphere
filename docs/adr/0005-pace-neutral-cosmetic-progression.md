# ADR-0005: Pace-neutral scoring and cosmetic progression

- **Status:** Accepted
- **Date:** 2026-08-28

## Context

Gamification must feel useful without reintroducing performance pressure. The
existing core loop deliberately avoids speed-centric rewards; any new
progression, achievement, or leaderboard system must preserve that guarantee.

## Decision

The server is the sole authority for scoring. Walk, run, and hike use identical
scoring rules. Pace, speed, heart rate, calories, and inferred fitness never
increase a score.

Progression grants fixed cosmetic XP from capped validated active minutes, quest
completion, active-day consistency, and versioned achievements. XP has no
gameplay effect and no bearing on matchmaking, eligibility, or territory value.
Achievements are versioned so a rule change supersedes prior definitions without
rewriting award history.

Missed days never reduce lifetime progress. Daily streak pressure is represented
only as an optional weekly consistency card that resets without loss.

## Consequences

- Scoring is reproducible from server-derived validation outputs and stored
  rule versions.
- No client-computed metric can award XP, rank, or a challenge result.
- Product, analytics, and auditing language must avoid athletic-worth framing.
- Cosmetic-only progression keeps the privacy and fairness surface unchanged.
