import type { H3Indexer } from './territory-claim.js';

/**
 * Where a claim is, coarsely — city, country, continent (pending-work 2.12-2.14).
 *
 * Territory is global: anybody can claim ground anywhere, and the boards are
 * city-scoped, country-scoped, and worldwide. That needs every claim to carry a
 * place name, and getting one means reverse geocoding, which means sending a
 * coordinate to somebody else's service. This file exists to make sure that
 * coordinate is never a person's.
 *
 * **The geocoder is asked about a cell, not about a runner.** A claim centroid
 * is resolved to a coarse H3 cell, and it is the *centre of that cell* that
 * goes out to be geocoded — a fixed point on a grid, identical for everybody
 * who ever runs in that cell, and typically kilometres from any of them. The
 * answer is cached against the cell forever, so the second claim in a cell asks
 * nobody anything. This is stronger than the "coarse location only" the plan
 * asks for: the external service receives no user-derived coordinate at all,
 * only a grid index it could have enumerated by itself.
 *
 * Nothing here performs network I/O. The geocoder arrives as an injected
 * function, and when none is configured a claim simply goes untagged rather
 * than being refused — an unreachable geocoder must never cost somebody their
 * ground.
 */

/**
 * H3 resolution of the geocode cache key: ~36 km² per cell.
 *
 * Chosen from both ends. Coarse enough that the key locates nobody — a res-6
 * cell spans a whole cluster of suburbs, and a claim is 5,000 m² to 5 km²
 * inside it. Fine enough to tell adjacent cities apart, which res 5 (~250 km²)
 * would not: it would put Mumbai and Thane in one cell and call them the same
 * place.
 */
export const GEO_TAG_RESOLUTION = 6;

/** Where a claim is, as the boards group it. */
export interface GeoTags {
  /** A place name as people would say it: `Mumbai`, `London`, `New York`. */
  cityTag: string;
  /** ISO 3166-1 alpha-2, upper case: `IN`, `GB`, `US`. */
  countryTag: string;
  /** `Asia`, `Europe`, `North America`. */
  continentTag: string;
}

/**
 * The cache and the geocoder behind it.
 *
 * `geocode` is optional. Without it this resolves from the cache alone, which
 * is how the launch market works: migration `038` seeds the Mumbai Metropolitan
 * Region's cells, so MMR claims are tagged with no network call ever made.
 * Everywhere else goes untagged until a proxy is configured, and the backfill
 * job picks those claims up afterwards.
 */
export interface GeoTagResolver {
  /** Tags already known for this cell, or `undefined` if it has never been asked. */
  cached(cell: string): Promise<GeoTags | undefined>;
  /** Remember tags for a cell. Cells do not move, so this never expires. */
  remember(cell: string, tags: GeoTags): Promise<void>;
  /**
   * Reverse geocode one point, which is always a cell centre and never a
   * runner's position. Absent when no provider is configured.
   */
  geocode?: (centre: readonly [number, number]) => Promise<GeoTags | undefined>;
}

const CONTINENTS = new Set([
  'Africa',
  'Antarctica',
  'Asia',
  'Europe',
  'North America',
  'Oceania',
  'South America'
]);

/** Trim, bound, and reject the empty string, which is not a place. */
const cleanName = (value: unknown, maxLength: number): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed.length > 0 && trimmed.length <= maxLength ? trimmed : undefined;
};

/**
 * A country code the boards can key on, or nothing.
 *
 * Upper-cased rather than rejected for case, because every geocoder disagrees
 * about that and a lower-case `in` is not a different country.
 */
export const normaliseCountryTag = (value: unknown): string | undefined => {
  const cleaned = cleanName(value, 2);
  return cleaned && /^[A-Za-z]{2}$/.test(cleaned) ? cleaned.toUpperCase() : undefined;
};

/**
 * Validate a geocoder's answer before it is stored or published.
 *
 * A geocoder is a third party, and its output ends up in a URL path
 * (`/leaderboard/city/Mumbai`) and on other people's screens. Anything that is
 * not a plausible place name is dropped whole rather than partly kept: a claim
 * tagged with a country and no city would sit on a country board while being
 * invisible on every city board, which is worse than being untagged.
 */
export const parseGeoTags = (value: unknown): GeoTags | undefined => {
  if (typeof value !== 'object' || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  const cityTag = cleanName(raw.cityTag, 80);
  const countryTag = normaliseCountryTag(raw.countryTag);
  const continentTag = cleanName(raw.continentTag, 20);
  if (!cityTag || !countryTag || !continentTag) return undefined;
  if (!CONTINENTS.has(continentTag)) return undefined;
  return { cityTag, countryTag, continentTag };
};

/** The cache key for a point: the coarse cell it falls in. */
export const geoTagCell = (
  latitude: number,
  longitude: number,
  h3Indexer: H3Indexer
): string | undefined =>
  Number.isFinite(latitude) &&
  Number.isFinite(longitude) &&
  Math.abs(latitude) <= 90 &&
  Math.abs(longitude) <= 180
    ? h3Indexer.cellAt(latitude, longitude, GEO_TAG_RESOLUTION)
    : undefined;

/**
 * Where this claim is, from the cache or from one geocode of a cell centre.
 *
 * Returns `undefined` rather than throwing on every failure path — an
 * unconfigured geocoder, a provider outage, a nonsense answer, a coordinate
 * that is not one. The caller stores what it gets and carries on: an untagged
 * claim is held ground that is missing from its city board, and a refused claim
 * is a run somebody did for nothing.
 */
export const detectCityTag = async (
  latitude: number,
  longitude: number,
  geocodeCache: GeoTagResolver,
  h3Indexer: H3Indexer
): Promise<(GeoTags & { cell: string }) | undefined> => {
  const cell = geoTagCell(latitude, longitude, h3Indexer);
  if (!cell) return undefined;

  const cached = await geocodeCache.cached(cell);
  if (cached) return { ...cached, cell };
  if (!geocodeCache.geocode) return undefined;

  // The cell centre, never the point that was passed in. This is the only
  // coordinate that leaves the product, and it belongs to the grid.
  let answer: GeoTags | undefined;
  try {
    answer = parseGeoTags(await geocodeCache.geocode(h3Indexer.cellCentre(cell)));
  } catch {
    return undefined;
  }
  if (!answer) return undefined;

  await geocodeCache.remember(cell, answer);
  return { ...answer, cell };
};
