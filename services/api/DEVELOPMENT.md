# API development configuration

The API returns CORS headers only to origins explicitly listed in `CORS_ALLOWED_ORIGINS`.

## M1 private-pilot persistence

The API requires PostgreSQL with PostGIS. Set `DATABASE_URL` (or the `POSTGRES_*` variables used by local Compose); on startup it applies ordered SQL files from `infra/postgres/migrations/` and records their names in `schema_migrations`.

```sh
make infra-up
POSTGRES_PASSWORD='your-local-password' AUTH_TOKEN_SECRET='a-long-random-secret' pnpm dev:api
```

M2 endpoints are contract-backed and documented through OpenAPI: adult registration/login/refresh/logout, authenticated privacy zones, and resumable activity create/chunk/finalize/status/history/delete. Chunk uploads are bounded to 500 points and 1 MiB of plain JSON. Every `PUT /v1/activities/:activityId/chunks` needs an `X-Chunk-Checksum` SHA-256 of the canonical JSON `{sequence,points}` payload. Gzip is deliberately rejected in M2 rather than decompressed server-side, avoiding a decompression-bomb boundary. Finalize requires the expected count and a SHA-256 of sequence-ordered chunk checksums; it reports missing sequences and retries are idempotent.

`GET /v1/activities` and `GET /v1/activities/:activityId` are owner-scoped. They return canonical summaries, trimmed derived GeoJSON, and policy/algorithm provenance only—never submitted raw points. `DELETE /v1/activities/:activityId` creates a tombstone, immediately removes raw chunks and derivations, and cancels pending work; workers check that tombstone before projection so a deleted activity cannot reappear. Raw-trace retention is explicit (checksum, retention deadline, purge timestamp) and defaults to 30 days.

The worker consumes `activity.finalized` outbox events continuously (5-second poll). It atomically claims pending events, reclaims stale 5-minute claims, retries at most five times, and marks only sanitized, parameterized failure details for operations review. Finalization has a unique outbox constraint and derivations are keyed by activity, making retries and post-crash reprocessing exactly-once projections. Use `WORKER_ONCE=true` for a one-pass job runner.

Run deterministic PostGIS integration coverage against a running local service explicitly:

```sh
RUN_POSTGIS_INTEGRATION=1 POSTGRES_PASSWORD='your-local-password' pnpm --filter @runsphere/api test
```

Do not use the development fallback `AUTH_TOKEN_SECRET` outside local testing. Supply a durable random secret through the deployment secret facility.
