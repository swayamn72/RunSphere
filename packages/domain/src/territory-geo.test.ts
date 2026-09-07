import { describe, expect, it, vi } from 'vitest';
import { h3Indexer } from './h3-indexer.js';
import {
  GEO_TAG_RESOLUTION,
  detectCityTag,
  geoTagCell,
  normaliseCountryTag,
  parseGeoTags,
  type GeoTagResolver,
  type GeoTags
} from './territory-geo.js';

/** Bandra, Mumbai. */
const BANDRA = { latitude: 19.0596, longitude: 72.8295 };
const MUMBAI: GeoTags = { cityTag: 'Mumbai', countryTag: 'IN', continentTag: 'Asia' };

/** A cache that records what it was asked, so the privacy claims are testable. */
const resolver = (
  seeded: Record<string, GeoTags> = {},
  geocode?: (centre: readonly [number, number]) => Promise<GeoTags | undefined>
) => {
  const remembered = new Map<string, GeoTags>();
  const asked: string[] = [];
  const geocoded: (readonly [number, number])[] = [];
  const wrapped: GeoTagResolver = {
    cached: async (cell) => {
      asked.push(cell);
      return remembered.get(cell) ?? seeded[cell];
    },
    remember: async (cell, tags) => {
      remembered.set(cell, tags);
    },
    ...(geocode
      ? {
          geocode: async (centre: readonly [number, number]) => {
            geocoded.push(centre);
            return geocode(centre);
          }
        }
      : {})
  };
  return { resolver: wrapped, asked, geocoded, remembered };
};

describe('the cache key', () => {
  it('is a coarse cell, not a point', () => {
    const cell = geoTagCell(BANDRA.latitude, BANDRA.longitude, h3Indexer);

    expect(cell).toBeDefined();
    // ~33 km² at resolution 6: a whole cluster of suburbs, and a claim is at
    // most 5 km² inside it. The key locates nobody.
    expect(h3Indexer.cellAreaSqm(cell!) / 1_000_000).toBeGreaterThan(20);
  });

  it('is the same cell for two runners a kilometre apart', () => {
    // The point of the coarse key: the cache is shared, so the second runner in
    // an area costs no lookup, and the key says nothing about either of them.
    // Derived from a cell centre rather than from two landmarks — a res-6 cell
    // is only about 6 km across, so two named suburbs can straddle a boundary
    // and the property being asserted is sharing, not the map of Mumbai.
    const centre = h3Indexer.cellCentre(geoTagCell(BANDRA.latitude, BANDRA.longitude, h3Indexer)!);
    const west = geoTagCell(centre[1], centre[0] - 0.005, h3Indexer);
    const east = geoTagCell(centre[1], centre[0] + 0.005, h3Indexer);

    expect(west).toBe(east);
  });

  it('refuses a coordinate that is not one', () => {
    expect(geoTagCell(Number.NaN, 72.8, h3Indexer)).toBeUndefined();
    expect(geoTagCell(91, 72.8, h3Indexer)).toBeUndefined();
    expect(geoTagCell(19, 181, h3Indexer)).toBeUndefined();
  });

  it('uses the resolution the migration seeded', () => {
    expect(GEO_TAG_RESOLUTION).toBe(6);
  });
});

describe('reading a geocoder answer', () => {
  it('accepts a complete one and upper-cases the country', () => {
    expect(parseGeoTags({ cityTag: 'Mumbai', countryTag: 'in', continentTag: 'Asia' })).toEqual(
      MUMBAI
    );
  });

  it('drops a partial answer whole rather than storing half of it', () => {
    // A country with no city would sit on a country board while being invisible
    // on every city board, which is worse than being untagged.
    expect(parseGeoTags({ countryTag: 'IN', continentTag: 'Asia' })).toBeUndefined();
    expect(parseGeoTags({ cityTag: 'Mumbai', continentTag: 'Asia' })).toBeUndefined();
    expect(parseGeoTags({ cityTag: 'Mumbai', countryTag: 'IN' })).toBeUndefined();
  });

  it('rejects a country code that is not one', () => {
    expect(normaliseCountryTag('IND')).toBeUndefined();
    expect(normaliseCountryTag('1N')).toBeUndefined();
    expect(normaliseCountryTag('')).toBeUndefined();
    expect(normaliseCountryTag(undefined)).toBeUndefined();
    expect(normaliseCountryTag('gb')).toBe('GB');
  });

  it('rejects a continent that is not one', () => {
    // These names end up in a URL path and on other people's screens, so an
    // answer from a third party is checked against a closed list.
    expect(
      parseGeoTags({ cityTag: 'Mumbai', countryTag: 'IN', continentTag: 'Middle Earth' })
    ).toBeUndefined();
  });

  it('rejects a city name long enough to be an attack rather than a place', () => {
    expect(
      parseGeoTags({ cityTag: 'x'.repeat(200), countryTag: 'IN', continentTag: 'Asia' })
    ).toBeUndefined();
  });

  it('tidies whitespace rather than trusting it', () => {
    expect(
      parseGeoTags({ cityTag: '  New   York ', countryTag: 'US', continentTag: 'North America' })
    ).toEqual({ cityTag: 'New York', countryTag: 'US', continentTag: 'North America' });
  });

  it('has nothing to say about a non-object', () => {
    expect(parseGeoTags(null)).toBeUndefined();
    expect(parseGeoTags('Mumbai')).toBeUndefined();
  });
});

describe('finding where a claim is', () => {
  it('answers from the cache without asking anybody', () => {
    const cell = geoTagCell(BANDRA.latitude, BANDRA.longitude, h3Indexer)!;
    const cache = resolver({ [cell]: MUMBAI });

    return detectCityTag(BANDRA.latitude, BANDRA.longitude, cache.resolver, h3Indexer).then(
      (found) => {
        expect(found).toMatchObject(MUMBAI);
        expect(cache.geocoded).toEqual([]);
      }
    );
  });

  it('geocodes the cell centre and never the runner position', () => {
    // The whole privacy design of this file. What leaves the product is a point
    // on a grid that anybody could have enumerated, not where somebody ran.
    const cache = resolver({}, async () => MUMBAI);

    return detectCityTag(BANDRA.latitude, BANDRA.longitude, cache.resolver, h3Indexer).then(
      (found) => {
        expect(found).toMatchObject(MUMBAI);
        expect(cache.geocoded).toHaveLength(1);
        const [sent] = cache.geocoded;
        expect(sent).not.toEqual([BANDRA.longitude, BANDRA.latitude]);
        // The cell centre, which is the fixed centre of a ~33 km² hexagon.
        const cell = geoTagCell(BANDRA.latitude, BANDRA.longitude, h3Indexer)!;
        expect(sent).toEqual(h3Indexer.cellCentre(cell));
      }
    );
  });

  it('remembers an answer so the next claim in that cell asks nobody', async () => {
    const geocode = vi.fn(async () => MUMBAI);
    const cache = resolver({}, geocode);

    await detectCityTag(BANDRA.latitude, BANDRA.longitude, cache.resolver, h3Indexer);
    // A different point in the same cell, taken from the cell centre so it is
    // certainly inside it.
    const centre = h3Indexer.cellCentre(geoTagCell(BANDRA.latitude, BANDRA.longitude, h3Indexer)!);
    await detectCityTag(centre[1], centre[0], cache.resolver, h3Indexer);

    expect(geocode).toHaveBeenCalledTimes(1);
  });

  it('goes untagged rather than refusing when no geocoder is configured', async () => {
    // Which is the state of this deployment: an untagged claim is real held
    // ground missing from a city board, and a refused claim is a run somebody
    // did for nothing.
    const cache = resolver({});

    expect(await detectCityTag(51.5, -0.12, cache.resolver, h3Indexer)).toBeUndefined();
  });

  it('goes untagged when the provider throws', async () => {
    const cache = resolver({}, async () => {
      throw new Error('provider down');
    });

    expect(await detectCityTag(51.5, -0.12, cache.resolver, h3Indexer)).toBeUndefined();
  });

  it('goes untagged, and remembers nothing, when the provider answers nonsense', async () => {
    const cache = resolver({}, async () => ({ cityTag: '' }) as unknown as GeoTags);

    expect(await detectCityTag(51.5, -0.12, cache.resolver, h3Indexer)).toBeUndefined();
    expect(cache.remembered.size).toBe(0);
  });

  it('has nothing to say about a coordinate that is not one', async () => {
    const cache = resolver({}, async () => MUMBAI);

    expect(await detectCityTag(Number.NaN, 0, cache.resolver, h3Indexer)).toBeUndefined();
    expect(cache.geocoded).toEqual([]);
  });
});
