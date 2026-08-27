# Contributing to RunSphere

Thank you for helping build a privacy-first outdoor movement product.

## Scope and principles

RunSphere is adults-only, walk/run/hike first, Android-first for MMR, and ships frequent green changes. Preserve these approved product constraints:

- quests are accessible at any pace and depend on versioned, reviewed checkpoint/POI data;
- territory is optional, seasonal (6–8 weeks), division-based, and scores only the best validated 60 minutes per day—not speed;
- location sharing is opt-in, delayed, coarse, and revocable;
- route privacy uses a server-side 200 m trim with provenance;
- v1 does not accept photo uploads;
- raw coordinates never belong in analytics, crash reports, test fixtures, issues, or logs.

Read the [product rulebook](docs/product.md), [safety and privacy rules](docs/safety-and-privacy.md), [architecture](docs/architecture.md), [release gates](docs/release-plan.md), and applicable [ADRs](docs/adr/README.md) before changing behavior.

## Working agreements

1. Keep changes small and focused. Prefer a feature flag/configured rollout for new scoring, recommendation, or safety behavior.
2. Add or update tests at the changed boundary. Use synthetic locations only through the gated test mode in ADR-0003; never enable it in a production build.
3. Do not commit credentials, traces, contact details, location-bearing crash payloads, screenshots with private route data, or production exports.
4. Preserve server authority for validation, checkpoint completion, privacy trimming, and territory awards.
5. Update documentation and the relevant ADR when changing a product, retention, privacy, cost, or architecture decision.

## Pull request checklist

- [ ] The change supports walk, run, and hike or explicitly documents a temporary limitation.
- [ ] Permission decline, offline, no-season, and not-enrolled states were considered where relevant.
- [ ] Location data is minimized; outward-facing routes use server-trimmed geometry only.
- [ ] Crash/analytics payloads were reviewed for coordinates and identifiers.
- [ ] Tests and staging smoke checks pass; rollout/rollback notes exist for data or scoring changes.
- [ ] Budget/capacity impact is known for worker, storage, map, or geocoding changes.
- [ ] Required docs/ADR updates are included.

## Reporting issues

Do not put a real person’s location, contact information, credentials, or raw activity trace in a public issue. For safety/privacy concerns, use the project’s designated private security/support channel once it exists. Until then, provide a minimal redacted reproduction to maintainers.
