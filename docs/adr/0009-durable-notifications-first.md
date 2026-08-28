# ADR-0009: Durable notifications first; defer Redis and WebSockets

- **Status:** Accepted
- **Date:** 2026-08-28

## Context

The product wants push, an inbox, and near-real-time state, which invites a
cache or socket layer by default. At current maturity a single Fastify API,
one worker, and one PostgreSQL/PostGIS authority remain the correct posture.

## Decision

The durable in-app inbox is the source of truth for notifications. Push
delivers an opaque notification ID and a safe deep link, never location or
sensitive scores. Reads use PostgreSQL read models plus short-TTL/ETag private
response caches and polling first.

Redis and WebSockets are deferred. They are added only when measured load shows
PostgreSQL cannot meet defined read/write gates and the forecasted overage has
the required approval under the cost bands.

## Consequences

- One write path and one deletion path simplify retention, export, and erasure.
- Notification delivery remains best-effort and auditable through the outbox.
- No socket or cache invalidation surface to secure during the early phases.
