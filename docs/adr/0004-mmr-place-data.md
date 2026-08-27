# ADR-0004: Curated MMR data with proxied Nominatim discovery

- **Status:** Accepted
- **Date:** 2026-08-27

## Context

Quest checkpoints need accurate, safe, accessible, and current MMR place data. Public geocoding results alone cannot establish that a place is reachable, open, or suitable for a checkpoint. Direct mobile calls also make third-party usage, caching, privacy, and cost controls difficult.

## Decision

Launch with a reviewed MMR place catalog containing source/provenance, versioned geometry, accessibility/access notes, freshness data, and publication state. Nominatim/OpenStreetMap may provide discovery input only through an application-identified server proxy/cache that is compliant with the current upstream policy. Mobile clients never call public Nominatim directly. No search result becomes a quest completion dependency without review.

Use controlled launch clusters and a closure/unpublish process. If data is stale, closed, or uncertain, remove the affected quest/checkpoint and offer a free activity or reviewed alternative.

## Consequences

- Launch coverage grows deliberately but supports trustworthy quests.
- A steward and field-verification process are required.
- Caching, rate limiting, attribution, and upstream-policy review are ongoing operational work, included in the map/geocoding budget cap.
