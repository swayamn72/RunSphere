# ADR-0002: Server-side privacy trimming and provenance

- **Status:** Accepted
- **Date:** 2026-08-27

## Context

Client-only map hiding can leak a raw route through APIs, cached artifacts, clubs, exports, or inconsistent clients. Route privacy needs a single authoritative transformation and explainable decisions.

## Decision

Apply saved privacy zones and a 200 m geodesic start/finish blur on the server before any activity geometry is shared, exported, surfaced in social views, or used as a display route. Remove segments inside the protected areas rather than drawing a visual mask. Retain raw submission data only in restricted encrypted storage for the approved retention period.

Create a provenance record for every trim: source and derived IDs/checksums, algorithm/policy version, zone IDs/geometry versions, time, removed-point count, and outcome. Downstream services receive only the derived shareable geometry. Territory uses separate aggregate H3 outputs and never receives a shareable raw route.

## Consequences

- All platforms get the same privacy boundary and a reviewable audit trail.
- Server processing adds latency, so the client shows a pending state rather than claiming final results offline.
- Support and deletion workflows need access controls and an auditable path to related derived artifacts.
