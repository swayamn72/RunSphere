# Architecture

## Scope and deployment posture

RunSphere is an implemented pnpm/Turbo monorepo for an MMR-only launch with a constrained operating budget. **Android v1** is the launch target; **iOS v1.1** reaches parity only after Android v1 gates pass. The current codebase establishes the application shell and local development topology; the product services described in [service boundaries](#service-boundaries) remain milestone-scoped delivery work.

## Implemented monorepo topology

The root `pnpm-workspace.yaml` includes `apps/*`, `services/*`, and `packages/*`. Root scripts delegate to Turbo 2 (`pnpm build`, `pnpm lint`, `pnpm test`, and `pnpm typecheck`), with dependency-aware `^build`, `^lint`, and `^typecheck` tasks; `dev` runs persistent workspace development tasks in parallel without caching.

| Directory                | Workspace                  | Current implementation                                                                                                                                                     |
| ------------------------ | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/mobile`            | `@runsphere/mobile`        | Expo / React Native Android app shell with MapLibre React Native, shared domain/UI dependencies, and Vitest model tests. It is the Android v1 client foundation.           |
| `apps/admin`             | `@runsphere/admin`         | Vite / React administrative web app using shared domain and UI packages.                                                                                                   |
| `services/api`           | `@runsphere/api`           | TypeScript Fastify 5 HTTP service with CORS. It currently provides `GET /health` and `GET /v1/quests`, and consumes config, contracts, domain, and observability packages. |
| `services/worker`        | `@runsphere/worker`        | TypeScript background-worker shell with structured observability logging.                                                                                                  |
| `packages/config`        | `@runsphere/config`        | Shared runtime configuration.                                                                                                                                              |
| `packages/contracts`     | `@runsphere/contracts`     | Shared API/data contracts.                                                                                                                                                 |
| `packages/domain`        | `@runsphere/domain`        | Shared domain models and demo quest data.                                                                                                                                  |
| `packages/observability` | `@runsphere/observability` | Shared structured logging primitives.                                                                                                                                      |
| `packages/ui`            | `@runsphere/ui`            | Shared UI package.                                                                                                                                                         |

### Local infrastructure with Compose

[`infra/compose.yaml`](../infra/compose.yaml) is the local infrastructure definition; application processes run through their workspace scripts rather than as Compose services. The default local profile runs PostgreSQL 18 with PostGIS on a private Compose network, named local volumes, health checks, and conservative resource limits. `make infra-up` validates `.env` and starts PostGIS.

Optional Compose profiles are deliberately local/development-oriented: `maps` adds Martin for application-owned PostGIS vector tiles, `routing` adds a Valhalla placeholder that requires a licensed private extract, `ops` adds local-only pgAdmin, and `scale` documents a replica placeholder. Do not treat Martin, Valhalla, or the replica placeholder as production-ready services. See [`infra/README.md`](../infra/README.md) for exact profile commands and boundary constraints.

```text
Android v1 Expo / React Native client          Admin Vite / React client
              │                                              │
              └────────────────── HTTPS ─────────────────────┘
                                      │
                         Fastify API (`services/api`)
                         /health · /v1/quests today
                                      │
                   shared config · contracts · domain · logs
                                      │
                     worker shell (`services/worker`)
                                      │
               Local Compose: PostgreSQL 18 + PostGIS
               optional Martin / Valhalla / pgAdmin profiles
```

### Target product-service topology

The following is the intended milestone topology, not a claim that all services are implemented today:

```text
Android v1 / iOS v1.1 client
  ├─ local encrypted activity queue + offline state
  ├─ location and optional motion adapters
  └─ authenticated HTTPS API
             │
             ▼
API / identity boundary
  ├─ accounts, 18+ assertion, preferences, safety contacts
  ├─ quest catalog + recommendation configuration
  ├─ activity submission + idempotency keys
  └─ season enrollment / read models
             │
             ▼
Validation workers and geospatial domain services
  ├─ GPS quality / anti-spoof checks
  ├─ private-zone trimming + provenance
  ├─ checkpoint and POI validation
  ├─ H3 traversal + best-60-minute scoring
  └─ derived activity, quest, territory aggregates
             │
             ▼
Managed relational store / object storage / cache
  ├─ operational records and derived aggregates
  ├─ encrypted raw-trace objects with restricted access
  └─ cached proxy responses for approved geocoding
```

## Service boundaries

| Boundary           | Responsibility                                                                         | Must not do                                                                           |
| ------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Client             | Capture with consent, offline queue, local display, explicit sharing controls          | Be authoritative for distance, checkpoints, cells, privacy trimming, or awards.       |
| Activity ingestion | Authenticate, size-limit, deduplicate, persist encrypted submitted trace               | Publish raw traces or award progress synchronously without validation.                |
| Validation         | Quality checks, trim route, checkpoint/POI eligibility, H3 traversal, derived outcomes | Infer health status or silently alter policy decisions.                               |
| Quest catalog      | Versioned POIs/checkpoints, hours/accessibility/source provenance, publication status  | Use unreviewed third-party POIs as a v1 completion dependency.                        |
| Recommendation     | Rank configured quest candidates using approved non-pace signals                       | Make irreversible decisions or use raw location history beyond needed coarse context. |
| Season scoring     | Enrollment/divisions, best-60-minute selection, cell contribution, aggregate ranks     | Expose raw traces or move participants between divisions mid-season.                  |
| Safety sharing     | Recipient authorization, delayed/coarse transform, automatic expiry                    | Send current/exact coordinates or historic routes.                                    |

All mutation APIs use an idempotency key. Activity processing is asynchronous and stateful (`received → validating → accepted/rejected → derived`). The client can show pending results but must reconcile from the server outcome.

## GPS quality, load, and distance baselines

Initial numeric rules are conservative validation baselines and are not claims of final field accuracy. Instrument them in Android pilot builds and freeze only under the conditions below.

| Area             | Initial baseline                                                                                                                                             | Baseline-then-freeze decision                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Activity start   | Require 3 location fixes within 30 seconds, with reported horizontal accuracy ≤50 m for a normal start; otherwise show recovery guidance                     | Freeze after ≥100 MMR outdoor starts across dense urban, waterfront, and open-space routes.                           |
| Point acceptance | Accept samples with horizontal accuracy ≤50 m; flag 50–100 m; reject >100 m for distance/cell traversal                                                      | Freeze only after comparing accepted/rejected sample distributions against annotated field traces.                    |
| Sampling         | Target one sample every 5 seconds while moving, with a 15-second maximum expected gap; record actual cadence                                                 | Freeze after battery and completeness study, not emulator-only testing.                                               |
| Distance         | Sum accepted geodesic segments; reject isolated implied speeds >25 km/h for walk/run/hike unless corroborated by subsequent samples; do not “fill” long gaps | Freeze error target at median absolute error ≤5% and p95 ≤12% against ≥30 measured reference routes spanning 1–10 km. |
| Battery          | Android tracking target: median ≤8% battery consumed per hour and p95 ≤12% on the pilot device matrix, screen off where OS permits                           | Freeze only after 20+ one-hour field sessions across 5+ representative Android devices and documented OS versions.    |
| GPS recovery     | Pause territory/cell eligibility after a >60-second invalid-data gap; retain clearly labeled recorded portion for private save                               | Freeze after reviewing false-pause rate in field study.                                                               |
| Adaptation       | Rules and thresholds in [product rulebook](product.md) run behind a versioned configuration                                                                  | Freeze changes after documented pilot review; client telemetry must record policy version, not raw route.             |

A failed quality gate is not an accusation of cheating. It is a transparent validation status with a reason and a path to save the non-competitive portion where safe.

## Data model and security

Core records are account, age assertion, consent, privacy zone, activity submission, raw trace object reference, trimmed activity, validation outcome, POI version, checkpoint version, quest version, season, enrollment, division assignment, score contribution, safety contact, and share session.

Separate identifiers for source submission and derived activity are required. Derivations are reproducible using stored policy/version references. Encrypt data in transit and at rest; limit raw trace access to a least-privilege validation/support role. Store credentials in the platform secret facility rather than client binaries or repository files.

## Mapping and place-data policy

Map display is an implementation concern separate from completion truth. For place search/geocoding, RunSphere uses a **server-side proxy and cache for Nominatim** under a documented compliant request policy; mobile clients never call public Nominatim directly and never send personal identifiers or raw traces to it. The proxy identifies the application, rate-limits requests, normalizes and caches permitted results, enforces a conservative per-instance request budget, and falls back to curated data or no-result states. The exact request rate and attribution implementation must be verified against the then-current Nominatim policy before production traffic.

OpenStreetMap/Nominatim output is discovery input, not automatic checkpoint truth. Any POI used by a quest must be curated/reviewed with provenance and freshness metadata. See [MMR data build strategy](cost-model.md#mmr-data-build-strategy).

## Architecture decisions

- [ADR-0001: H3 territory traversal](adr/0001-h3-territory-traversal.md)
- [ADR-0002: Server-side privacy trimming and provenance](adr/0002-server-side-privacy-trimming.md)
- [ADR-0003: Controlled synthetic GPS test mode](adr/0003-synthetic-gps-test-mode.md)
- [ADR-0004: Curated MMR data with proxied Nominatim discovery](adr/0004-mmr-place-data.md)
