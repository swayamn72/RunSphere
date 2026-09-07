import type { Database } from '@runsphere/db';
import { detectCityTag, h3Indexer, type GeoTagResolver, type GeoTags } from '@runsphere/domain';

/**
 * Tag claims whose place was unknown when they were made (pending-work 2.12-2.14).
 *
 * A claim is tagged at claim time from the geocode cache, and `038` seeds that
 * cache for the launch market — so an MMR claim is tagged the moment it is
 * made, with no provider involved. A claim anywhere else lands untagged: it
 * counts on the global board and on no city board, and waits here.
 *
 * This job does two things on each sweep:
 *
 *   1. Re-checks untagged claims against the cache. A claim made in a cell that
 *      has since been resolved gets its tags without any lookup at all, which
 *      is what happens to the second, third, and hundredth runner in a new city
 *      after the first one caused it to be geocoded.
 *   2. Resolves cells the cache has never seen, if a geocoder is configured.
 *
 * **No geocoder is configured on this deployment.** The provider is a gated
 * dependency, like FCM and email: the seam is here, the cache is here, and
 * without a `geocode` function this job resolves from the cache and stops.
 * That is why claims outside MMR stay untagged rather than being wrong.
 *
 * The privacy design lives in `territory-geo.ts`: what gets geocoded is the
 * centre of a ~33 km² grid cell, never a runner's coordinate.
 */

/** How many untagged claims one sweep will look at. */
const BACKFILL_BATCH = 50;

/**
 * How many cells one sweep will pay a provider to resolve.
 *
 * Low on purpose. A geocoding provider is metered and rate limited, and the
 * cost model puts map and geocoding misses among the first things to throttle
 * under budget pressure (`cost-model.md`). Cells are cached forever, so a slow
 * drip converges on complete coverage anyway.
 */
const GEOCODE_BUDGET_PER_SWEEP = 5;

/** The cache, backed by `territory_geo_cells`. */
export const createGeoTagResolver = (
  db: Database,
  geocode?: (centre: readonly [number, number]) => Promise<GeoTags | undefined>
): GeoTagResolver => ({
  cached: async (cell) => {
    const found = await db.query<{
      city_tag: string;
      country_tag: string;
      continent_tag: string;
    }>(
      `SELECT city_tag, country_tag, continent_tag FROM territory_geo_cells
       WHERE h3_cell = $1`,
      [cell]
    );
    const row = found.rows[0];
    return row
      ? {
          cityTag: row.city_tag,
          countryTag: row.country_tag,
          continentTag: row.continent_tag
        }
      : undefined;
  },
  remember: async (cell, tags) => {
    await db.query(
      `INSERT INTO territory_geo_cells (h3_cell, resolution, city_tag, country_tag,
         continent_tag, source)
       VALUES ($1, $2, $3, $4, $5, 'geocode')
       ON CONFLICT (h3_cell) DO NOTHING`,
      [cell, 6, tags.cityTag, tags.countryTag, tags.continentTag]
    );
  },
  ...(geocode ? { geocode } : {})
});

/**
 * Tag one claim's centroid, if its place can be determined.
 *
 * Returns whether it was tagged. Used at claim time as well as here, so a claim
 * and a backfill can never disagree about where the same ground is.
 */
export const tagClaimPlace = async (
  db: Database,
  claim: { id: string; latitude: number; longitude: number },
  resolver: GeoTagResolver
): Promise<boolean> => {
  const tags = await detectCityTag(claim.latitude, claim.longitude, resolver, h3Indexer);
  if (!tags) return false;
  await db.query(
    `UPDATE territory_claims
     SET city_tag = $2, country_tag = $3, continent_tag = $4
     WHERE id = $1 AND city_tag IS NULL`,
    [claim.id, tags.cityTag, tags.countryTag, tags.continentTag]
  );
  return true;
};

/**
 * One sweep of the backfill.
 *
 * Reads the claim centroid, which is already the coarsest thing stored about a
 * claim's position and is published on the map anyway.
 */
export const processTerritoryGeoTags = async (
  {
    db,
    geocode
  }: {
    db: Database;
    geocode?: (centre: readonly [number, number]) => Promise<GeoTags | undefined>;
  },
  _now: Date = new Date()
): Promise<{ tagged: number; geocoded: number }> => {
  const untagged = await db.query<{ id: string; latitude: number; longitude: number }>(
    `SELECT id, ST_Y(centroid) AS latitude, ST_X(centroid) AS longitude
     FROM territory_claims
     WHERE city_tag IS NULL
     ORDER BY claimed_at DESC
     LIMIT $1`,
    [BACKFILL_BATCH]
  );
  if (untagged.rows.length === 0) return { tagged: 0, geocoded: 0 };

  // Pass one: cache only. Cheap, and resolves the common case where somebody
  // else's claim already caused this cell to be looked up.
  const cacheOnly = createGeoTagResolver(db);
  let tagged = 0;
  const unresolved: typeof untagged.rows = [];
  for (const claim of untagged.rows) {
    if (
      await tagClaimPlace(
        db,
        {
          id: claim.id,
          latitude: Number(claim.latitude),
          longitude: Number(claim.longitude)
        },
        cacheOnly
      )
    )
      tagged += 1;
    else unresolved.push(claim);
  }

  if (!geocode || unresolved.length === 0) return { tagged, geocoded: 0 };

  // Pass two: spend the sweep's small budget on cells nobody has resolved.
  const withGeocoder = createGeoTagResolver(db, geocode);
  let geocoded = 0;
  for (const claim of unresolved.slice(0, GEOCODE_BUDGET_PER_SWEEP)) {
    if (
      await tagClaimPlace(
        db,
        {
          id: claim.id,
          latitude: Number(claim.latitude),
          longitude: Number(claim.longitude)
        },
        withGeocoder
      )
    ) {
      tagged += 1;
      geocoded += 1;
    }
  }
  return { tagged, geocoded };
};
