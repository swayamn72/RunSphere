# MMR data build strategy and cost model

## MMR data build strategy

MMR launch quality depends more on a small trustworthy place catalog than a large unverified one. Build in expanding rings:

1. **Seed a reviewed core:** select a limited set of public, accessible parks, promenades, waterfronts, trailheads, and path corridors across representative MMR neighborhoods. Record source, geometry, access constraints, hours, review date, and steward.
2. **Create safe checkpoint shapes:** use place, corridor, or open-space checkpoints as defined in the [product rulebook](product.md#quest-eligibility-and-poi-dependency). Avoid entrances, private residences, restricted facilities, and unsafe roadside pin placement.
3. **Field verify:** sample each launch cluster on foot at different times. Verify approachability, public access, GPS behavior, obvious closures, and accessibility claims. A source-only record cannot become a completion dependency without review.
4. **Publish gradually:** enable quests only in clusters meeting capacity, freshness, and operations criteria. Keep free activity available elsewhere in MMR.
5. **Maintain:** assign a data steward, closure-report path, 30-day volatile-data review cadence, and immediate unpublish procedure. Preserve provenance/version history for each change.

### Nominatim and OpenStreetMap policy

Nominatim is used only through the server proxy/cache described in [architecture](architecture.md#mapping-and-place-data-policy). It may help discovery or address lookup, but it does not create an automatic quest checkpoint. Confirm current upstream policy, identification, attribution, caching, and rate constraints before enabling production requests. Cache normalized allowed queries, throttle aggressively, and prefer curated/local results. Do not use public Nominatim as a bulk geocoding pipeline or real-time client dependency.

## Cost governance: soft target and approval bands

₹3,000/month is a **soft operating target, not a launch ceiling** (see
[ADR-0010](adr/0010-cost-governance-approval-bands.md)). Every phase maintains
base, expected-growth, and stress forecasts with feature-unit assumptions and an
actual-versus-forecast review. Approval bands are:

|   Band | Range                                | Approval                                                        |
| -----: | ------------------------------------ | --------------------------------------------------------------- |
|  Green | ≤ ₹3,000                             | Normal                                                          |
|  Amber | > ₹3,000–₹4,500                      | Product/operations owner                                        |
| Orange | > ₹4,500–₹7,500                      | Budget/finance owner, with a growth or territory case           |
|    Red | > ₹7,500 or a material forecast miss | Executive budget approval and an explicit continuation decision |

Owners may tune the band values before rollout but must not remove the bands.
Alerts fire before and within each band. Graceful controls reduce staging
uptime, campaign throughput, optional analytics/log volume, map/geocoding
misses, and snapshot-refresh frequency before limiting enrollment or deferring
expansion. Cost controls must never weaken authentication, privacy trimming,
validation, deletion, moderation, legal/security notices, backups, or audit
evidence. Justified overage is allowed for measured growth, territory
processing, or reliability when the approval, owner, duration, success metric,
and rollback are documented.

## Monthly infrastructure budget

The original green-band baseline allocation is ₹3,000/month, excluding app-store developer program fees, taxes, payment fees, and one-time human data-verification labor. Use free/low-cost managed tiers first; each provider amount must be replaced with actual invoices before public launch.

| Cost area                          | Monthly cap (₹) | Control                                                                                               |
| ---------------------------------- | --------------: | ----------------------------------------------------------------------------------------------------- |
| API/compute and scheduled workers  |             800 | Autosuspend non-production, quota activity processing, set provider budget alert at 70%.              |
| Managed database                   |             750 | One region, indexed derived records, retention jobs, no raw traces in hot tables.                     |
| Object storage and backups         |             350 | Encrypt/compress traces, lifecycle raw/derived objects according to approved retention, test restore. |
| Maps, tiles, geocoding proxy/cache |             350 | Cache-first, curated fallback, no direct public Nominatim clients, track per-provider usage.          |
| Observability/crash reporting      |             250 | Coordinate scrubber, sampled logs, error budget alerts, avoid high-cardinality raw payloads.          |
| Auth, email, notifications         |             250 | Free tier where suitable; minimal transactional notifications.                                        |
| Contingency                        |             250 | Held for small usage variance; no feature expansion funded implicitly.                                |
| **Total**                          |       **3,000** | Green-band baseline; crossing a band requires the owner approval defined above.                       |

## Staging and production cost spike

Use separate provider projects/accounts and immutable cost-centre tags (`environment=staging` and `environment=production`) so staging cannot consume production contingency. The initial monthly allocation is intentionally below the ₹3,000 green target to absorb metering variance:

| Environment  | API/worker | Database + backup | Storage/maps/observability/auth | Reserved variance | Total (₹) |
| ------------ | ---------: | ----------------: | ------------------------------: | ----------------: | --------: |
| Staging      |        150 |               150 |                             100 |                 0 |       400 |
| Production   |        650 |               600 |                             950 |               400 |     2,600 |
| **Combined** |    **800** |           **750** |                       **1,050** |           **400** | **3,000** |

Provision only a single MMR-region production stack: a small API/worker runtime, one managed Postgres/PostGIS primary with daily backup and restore validation, object storage with lifecycle deletion, cache-first place lookup, and sampled/scrubbed logs. Staging uses the same migration and readiness checks but autosuspends outside release windows. Martin, Valhalla, replicas, and territory are excluded from this spike; enabling any of them requires an approved amended forecast.

### Encryption and key-management trade-offs

- **Recommended launch posture:** use managed database/object-storage encryption at rest with a provider-managed key, TLS in transit, separate least-privilege runtime roles, encrypted backups, and secret-manager rotation. This stays inside the cap and avoids an extra key-management service or a self-hosted key escrow burden.
- **Trade-off:** provider-managed keys provide less tenant-controlled rotation/audit separation than customer-managed keys. Record the provider key identifiers and access policy in deployment inventory; raw traces remain restricted and expire through lifecycle controls.
- **Do not self-manage encryption keys** at launch: keeping KMS material, recovery, rotation, HSM backups, and dual-control procedures operationally correct would exceed the team and budget constraints. Move to customer-managed keys only after a legal/compliance requirement and a funded recovery exercise.

## Cost gates and fallback actions

- Provider budget notifications remain at **70% (₹2,100)** and **85% (₹2,550)** of the green-band baseline. Route both to the on-call operations channel and finance owner; create a ticket automatically at 70% and page the release owner at 85%.
- At 70% of green, freeze non-production spend, inspect per-provider daily run rate, and reduce cache-miss/map lookup, verbose logs, and non-essential jobs. At 85% of green, autosuspend staging and require the band owner's explicit approval before resuming. Do not weaken privacy, deletion, backup, or activity validation safeguards.
- Approaching an amber/orange/red boundary requires the corresponding owner approval and, for orange and above, a documented growth or territory case with a duration, success metric, and rollback.
- Graceful controls reduce staging uptime, campaign throughput, optional analytics/log volume, map/geocoding misses, and snapshot-refresh frequency before limiting enrollment or deferring expansion. They never weaken authentication, privacy trimming, validation, deletion, moderation, legal/security notices, backups, or audit evidence.
- Review provider invoices and tagged usage weekly; record actuals separately for production, staging, and development. Staging cannot consume the production contingency.
- If map/geocoding spend grows, reduce live lookup through cache/curated data before reducing privacy or validation safeguards.
- If storage grows, adjust retention only after privacy/legal approval; do not silently retain less data than a published policy.
- A territory season needs a separate pre-season capacity forecast for validation-worker and database load, reviewed against the current operating band. Do not open enrollment if the forecast crosses an unapproved band boundary.

## Baseline measurements that affect cost

The M1/M2 field study records accepted-point cadence, average trace size, upload retries, validation time, map/geocoding cache hit rate, and crash-event volume. Freeze capacity assumptions after the documented field sample, then revise the table using measured p50/p95 values before M4. Synthetic GPS may test scale only under the controls in [ADR-0003](adr/0003-synthetic-gps-test-mode.md); it cannot substitute for field battery or GPS quality data.
