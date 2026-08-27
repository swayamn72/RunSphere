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

## Monthly infrastructure budget

**Maximum steady-state infrastructure budget: ₹3,000/month.** This is a hard launch constraint, excluding app-store developer program fees, taxes, payment fees, and one-time human data-verification labor. Use free/low-cost managed tiers first; each provider amount must be replaced with actual invoices before public launch.

| Cost area                          | Monthly cap (₹) | Control                                                                                               |
| ---------------------------------- | --------------: | ----------------------------------------------------------------------------------------------------- |
| API/compute and scheduled workers  |             800 | Autosuspend non-production, quota activity processing, set provider budget alert at 70%.              |
| Managed database                   |             750 | One region, indexed derived records, retention jobs, no raw traces in hot tables.                     |
| Object storage and backups         |             350 | Encrypt/compress traces, lifecycle raw/derived objects according to approved retention, test restore. |
| Maps, tiles, geocoding proxy/cache |             350 | Cache-first, curated fallback, no direct public Nominatim clients, track per-provider usage.          |
| Observability/crash reporting      |             250 | Coordinate scrubber, sampled logs, error budget alerts, avoid high-cardinality raw payloads.          |
| Auth, email, notifications         |             250 | Free tier where suitable; minimal transactional notifications.                                        |
| Contingency                        |             250 | Held for small usage variance; no feature expansion funded implicitly.                                |
| **Total**                          |       **3,000** | Do not exceed without an approved budget decision.                                                    |

## Cost gates and fallback actions

- Alert at 70% (₹2,100), investigate at 85% (₹2,550), and block non-essential traffic/features before projected spend crosses ₹3,000.
- Monthly reporting must separate production, staging, and development use; staging cannot consume the production contingency.
- If map/geocoding spend grows, reduce live lookup through cache/curated data before reducing privacy or validation safeguards.
- If storage grows, adjust retention only after privacy/legal approval; do not silently retain less data than a published policy.
- A territory season needs a separate pre-season capacity forecast for validation-worker and database load. Do not open enrollment if the forecast breaks the cap.

## Baseline measurements that affect cost

The M1/M2 field study records accepted-point cadence, average trace size, upload retries, validation time, map/geocoding cache hit rate, and crash-event volume. Freeze capacity assumptions after the documented field sample, then revise the table using measured p50/p95 values before M4. Synthetic GPS may test scale only under the controls in [ADR-0003](adr/0003-synthetic-gps-test-mode.md); it cannot substitute for field battery or GPS quality data.
