# ADR-0010: Cost governance — soft target with approval bands

- **Status:** Accepted
- **Date:** 2026-08-28

## Context

The original cost model treated ₹3,000/month as a hard launch cap. Territory,
clubs, notifications, and later phases each carry their own load forecasts, and
a hard ceiling would either block justified growth or invite quietly exceeded
budgets.

## Decision

₹3,000/month becomes a soft operating target. Every phase maintains base,
expected-growth, and stress forecasts with feature-unit assumptions and an
actual-versus-forecast review. Approval bands are:

- Green ≤ ₹3,000 — normal.
- Amber > ₹3,000–₹4,500 — product/operations owner approval.
- Orange > ₹4,500–₹7,500 — budget/finance owner approval plus a growth or
  territory case.
- Red > ₹7,500 or a material forecast miss — executive budget approval and an
  explicit continuation decision.

Owners may tune band values before rollout but must not remove the bands. Alerts
fire before and within each band. Graceful controls scale down non-essential
work before limiting enrollment or deferring expansion. Controls never weaken
authentication, privacy trimming, validation, deletion, moderation, legal or
security notices, backups, or audit evidence.

## Consequences

- The M4 launch gate and cost tables are rewritten to reference bands instead of
  a hard cap.
- Each expansion phase or territory season includes its own forecast and
  observed-spend review against the current band.
- Justified overage is allowed only with approval, owner, duration, success
  metric, and rollback documented.
