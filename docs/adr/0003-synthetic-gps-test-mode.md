# ADR-0003: Controlled synthetic GPS test mode

- **Status:** Accepted
- **Date:** 2026-08-27

## Context

Deterministic route tests are necessary for checkpoint, H3, privacy-trim, offline, and scoring behavior. Unrestricted mock locations could contaminate production territory, safety sharing, or analytics.

## Decision

Provide synthetic GPS only in explicitly non-production builds and test environments. It requires all of the following: a compile-time non-production build flavor, a runtime test-mode flag delivered only by the test environment, a test account, and a server environment marked non-production. Events and submissions carry a `synthetic=true` marker; production ingestion rejects them.

The test-mode UI must visibly state that simulated location is active. Synthetic traces use known fixtures with no real private addresses. They may exercise scale and deterministic logic but cannot satisfy field GPS, distance, battery, accessibility, or safety validation gates.

## Consequences

- Automated and manual QA can reproduce boundary cases without creating misleading live activity.
- Release tooling must assert that production artifacts exclude the flag/code path and production APIs reject synthetic markers.
- Field study remains mandatory before freezing quality baselines.
