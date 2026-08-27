# API development configuration

The API returns CORS headers only to origins explicitly listed in `CORS_ALLOWED_ORIGINS`.

## M1 private-pilot persistence

The API requires PostgreSQL with PostGIS. Set `DATABASE_URL` (or the `POSTGRES_*` variables used by local Compose); on startup it applies ordered SQL files from `infra/postgres/migrations/` and records their names in `schema_migrations`.

```sh
make infra-up
POSTGRES_PASSWORD='your-local-password' AUTH_TOKEN_SECRET='a-long-random-secret' pnpm dev:api
```

M1 endpoints are contract-backed and documented through OpenAPI: adult registration/login/refresh/logout, authenticated privacy zones, and idempotent activity create/chunk/finalize/status. The worker consumes `activity.finalized` outbox events and writes only the server-derived, privacy-trimmed route plus provenance.

Run deterministic PostGIS integration coverage against a running local service explicitly:

```sh
RUN_POSTGIS_INTEGRATION=1 POSTGRES_PASSWORD='your-local-password' pnpm --filter @runsphere/api test
```

Do not use the development fallback `AUTH_TOKEN_SECRET` outside local testing. Supply a durable random secret through the deployment secret facility.
