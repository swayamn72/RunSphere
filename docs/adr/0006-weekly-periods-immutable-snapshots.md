# ADR-0006: Asia/Kolkata weekly periods and immutable snapshot resets

- **Status:** Accepted
- **Date:** 2026-08-28

## Context

Weekly consistency, challenges, boards, and territory rounds all need a common
wall-clock boundary that is stable for users and reproducible for scoring
audits.

## Decision

Weekly periods use Asia/Kolkata, Monday 00:00 through the following Monday.
Period identity is deterministic from the start timestamp and is never derived
from upload order or client clocks.

A reset creates an immutable period record and an immutable snapshot version. It
never deletes or mutates prior snapshots. Standings are recomputed into the new
snapshot from the final accepted contribution set; reversals or late accepted
contributions produce a later snapshot version rather than rewriting the
previous one.

## Consequences

- Disputes reproduce any historical snapshot from stored rule and period
  versions.
- Retention policy can archive old period snapshots without scoring ambiguity.
- Client clocks are never trusted for period assignment.
