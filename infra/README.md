# RunSphere local infrastructure

This directory provides a deliberately small local stack for RunSphere. Compose has no implicit default profile: use `make infra-up` to start the `local` profile, which runs PostgreSQL 18 with PostGIS using named volumes and a private Compose network. It is sized as a development baseline and an initial Mumbai-region deployment reference, not a production deployment recipe.

## Prerequisites

- Docker Engine with the Compose plugin
- GNU Make
- A shell compatible with POSIX `sh`

Copy the example configuration and replace every placeholder before starting:

```sh
cp .env.example .env
make infra-validate
make infra-up
```

The database is ready when Docker reports `postgres` as healthy. Connect from the host with the credentials in `.env`, or from a Compose service using `postgres:5432`.

## Profiles

| Profile   | Command              | Services                         | Intended use                                |
| --------- | -------------------- | -------------------------------- | ------------------------------------------- |
| `local`   | `make infra-up`      | PostgreSQL + PostGIS             | Everyday development                        |
| `demo`    | `make infra-demo`    | PostgreSQL + PostGIS             | Isolated demo data                          |
| `maps`    | `make infra-maps`    | PostgreSQL + Martin              | Application-owned PostGIS vector tiles      |
| `routing` | `make infra-routing` | PostgreSQL + Valhalla            | Licensed, privately hosted routing extracts |
| `ops`     | `make infra-ops`     | PostgreSQL + local pgAdmin       | Local database inspection only              |
| `scale`   | `make infra-scale`   | PostgreSQL + replica placeholder | Documents a future managed-replica topology |

Stop containers without deleting data using `make infra-down`. `make infra-reset` deletes the named local volumes and is destructive.

## Configuration validation

`make infra-validate` checks that `.env` exists; rejects every shipped placeholder, including placeholders embedded in connection URLs; requires distinct standalone passwords and the embedded Martin URL password to be at least 16 characters; validates required email, URL, and port values; and asks Docker Compose to render the final configuration when Docker is available. It does not verify credentials against a running database. Run `./infra/scripts/test-validate-config.sh` to exercise the validator with valid, placeholder (including embedded URL), short-secret, duplicate-secret, and invalid-port cases.

Required values:

- `POSTGRES_PASSWORD`: unique database password of at least 16 characters.
- `PGADMIN_DEFAULT_EMAIL`: pgAdmin administrator email.
- `PGADMIN_DEFAULT_PASSWORD`: separate local-operations password of at least 16 characters.
- `MARTIN_DATABASE_URL`: PostgreSQL URL for the `martin` Compose hostname, normally matching the local database credentials. Replace the embedded password too.
- `*_HOST_PORT`: numeric local ports from 1 through 65535.

Never commit `.env`. The existing ignore rule protects it; only `.env.example` is intended for source control.

## Mapping and routing boundaries

Martin is optional and only exposes vector tiles derived from data that RunSphere owns or is licensed to serve. It intentionally does not use public OpenStreetMap tile servers as a production dependency. Valhalla is pinned to the immutable digest for the published `3.5.1` image and remains a placeholder until a licensed, privately hosted Mumbai-region extract is supplied through `VALHALLA_TILE_URLS`; leave that value empty for local configuration validation. Assess source-data licensing, refresh cadence, and storage requirements before enabling routing.

All published Compose ports bind to `127.0.0.1`, so the local profiles are not reachable from the network by default. pgAdmin runs in authenticated server mode and must remain local-only. In deployment, bind database and operations access to a private subnet/security group and place any application API behind TLS and authentication.

## Deployment notes and initial budget posture

The Compose limits are intentionally conservative: PostgreSQL is limited to 512 MiB / 0.75 CPU, Martin to 256 MiB / 0.25 CPU, pgAdmin to 256 MiB / 0.25 CPU, and Valhalla to 1 GiB / 1 CPU. The PostgreSQL settings cap connections at 40 and prioritize predictable memory use. This makes a small 2 vCPU / 4 GiB instance, with managed backups and a modest SSD volume, a plausible starting point for the Mumbai region within a ₹3,000/month infrastructure target.

Before a public launch:

1. Use encrypted managed block storage or a managed PostgreSQL offering with automated daily backups and point-in-time recovery where affordable.
2. Keep database and admin endpoints private; grant app access with a least-privilege role and rotate secrets through the deployment platform.
3. Monitor storage, CPU, connection saturation, slow queries, backup restore tests, and egress. Set budget alerts below the monthly cap.
4. Run a restore drill and retain only the location data necessary for product operation.
5. Do not enable the `scale` placeholder directly. Replace it with tested managed replication, read routing, failover, and backup procedures once production load requires it.
6. Budget mapping/routing data hosting separately. A regional routing extract may exceed the limits and budget of the base stack.

## Service probes and metrics

The API provides three intentionally separate operational endpoints:

- `GET /health` is a liveness response and does not require a database.
- `GET /ready` verifies the database query path and returns `503` until it is usable; point deployment readiness checks here.
- `GET /metrics` exposes low-cardinality Prometheus text metrics for process uptime and response status totals. Keep it private to the monitoring collector; it has no user, activity, location, or token labels.

Alert when readiness fails for 5 minutes, 5xx responses exceed 2% over 15 minutes, or the production budget crosses the 70%/85% thresholds in [the cost model](../docs/cost-model.md#cost-gates-and-fallback-actions). Do not expose `/metrics`, pgAdmin, Postgres, Martin, or Valhalla on the public internet.

## CI

The repository workflow provisions the same PostgreSQL 18 + PostGIS image as a GitHub Actions service, uses Node 22.21.0 to match the declared 22.x engine, installs and verifies PostGIS, checks formatting, validates MapLibre New Architecture compatibility before map rendering is introduced, runs the infrastructure validator test suite, and runs the workspace lint, type-check, test, API health-endpoint test, and build commands.
