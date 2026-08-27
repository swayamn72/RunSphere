# RunSphere

RunSphere is a privacy-first outdoor movement app for adults in the Mumbai Metropolitan Region (MMR). It turns **walks, runs, and hikes** into adaptive exploration quests, with optional, fair seasonal territory play.

**Android v1** is the launch platform. **iOS v1.1** follows after the Android v1 launch gates are met. The product is designed for frequent, small green releases rather than large batched drops.

## Product at a glance

- **Run / walk / hike first:** every core loop works without fast running.
- **Hybrid quests:** a stable nearby quest catalog plus adaptive recommendations based on declared movement, availability, accessibility preferences, recent load, and local conditions.
- **Optional territory seasons:** fair 6–8 week H3-cell seasons; a participant’s best 60 minutes per day count, independent of pace.
- **Privacy and safety by default:** adults-only age assertion, explicit location consent, 200 m privacy blurs, server-side route trimming, and opt-in delayed coarse sharing with safety contacts.
- **MMR-first operations:** curated, verified local place data and a monthly infrastructure ceiling of ₹3,000.

## Quickstart

### Prerequisites

- Node.js 22 or later
- pnpm 10.12.1 or later
- Docker Engine with the Compose plugin and GNU Make for local PostGIS

Install workspace dependencies and run the repository checks:

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Start local PostGIS, then start the API, mobile app, or admin app in separate terminals:

```sh
cp .env.example .env
# Replace the placeholder passwords and MARTIN_DATABASE_URL in .env.
make infra-up

pnpm dev:api
pnpm dev:mobile
pnpm dev:admin
```

Run all Turbo development tasks together with:

```sh
pnpm dev
```

The Fastify API exposes `GET /health` and `GET /v1/quests`; see [architecture](docs/architecture.md) for the current implementation topology and [local infrastructure](infra/README.md) for Compose profiles.

## Documentation

- [Product and gameplay](docs/product.md)
- [Safety and privacy](docs/safety-and-privacy.md)
- [Architecture](docs/architecture.md)
- [Release plan and quality gates](docs/release-plan.md)
- [MMR data and cost model](docs/cost-model.md)
- [Design-artifact traceability](docs/design-reference.md)
- [Approved portable design artifacts](docs/design/)
- [Architecture decision records](docs/adr/README.md)
- [Contributing](CONTRIBUTING.md)

## Status

The repository is an implemented pnpm/Turbo monorepo: an Expo Android mobile app, Vite/React admin app, Fastify API, background-worker shell, shared packages, and local PostGIS Compose stack are present. Product delivery remains milestone-gated: **Android v1** is the MMR launch target, and **iOS v1.1** follows after Android v1 gates pass. Do not treat numeric baselines as launch claims; they are acceptance targets to measure and freeze during the specified field-validation milestones.
