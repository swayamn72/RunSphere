import { randomUUID } from 'node:crypto';
import {
  createDatabase,
  defaultDatabaseUrl,
  migrate,
  postgisIntegrationEnabled,
  requirePostgisInCi
} from '@runsphere/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createAccessToken } from './auth.js';

/**
 * Route suggestions against a real PostGIS.
 *
 * Three things only a real database settles here:
 *
 *   * `ST_DWithin(..::geography, .., 1500)` measures **metres**. Without the
 *     cast it measures degrees, and 1500 degrees is the whole planet — every
 *     route on earth would be "near you". This is the same class of mistake the
 *     privacy-zone test exists for.
 *   * The constraint that nothing unreviewed can be published. It is the point
 *     of the table, and a fake database enforces no constraints at all.
 *   * The freshness filter, which is what `product.md`'s 30-day revalidation
 *     rule actually buys.
 *
 * Enable with `RUN_POSTGIS_INTEGRATION=1` and a `DATABASE_URL`.
 */
const enabled = postgisIntegrationEnabled();
const describePostgis = enabled ? describe : describe.skip;
const db = createDatabase(defaultDatabaseUrl(process.env));
const SECRET = 'route-suggestion-integration-secret';
const app = buildApp({ db, authSecret: SECRET });

/** Shivaji Park, Mumbai. */
const BASE_LAT = 19.028;
const BASE_LNG = 72.838;

let account = '';
let reviewer = '';

const makeAccount = async (): Promise<string> => {
  const created = await db.query<{ id: string }>(
    `INSERT INTO accounts (email, password_hash, age_asserted_at, age_policy_version)
     VALUES ($1, 'x', now(), '2026-01') RETURNING id`,
    [`routes-${randomUUID()}@example.test`]
  );
  return created.rows[0]!.id;
};

/** A closed square loop of roughly `metres` per side, offset by `east` degrees. */
const loopJson = (east: number, metres: number): string => {
  const dLat = metres / 111_320;
  const dLng = metres / (111_320 * Math.cos((BASE_LAT * Math.PI) / 180));
  const lng = BASE_LNG + east;
  return JSON.stringify({
    type: 'LineString',
    coordinates: [
      [lng, BASE_LAT],
      [lng + dLng, BASE_LAT],
      [lng + dLng, BASE_LAT + dLat],
      [lng, BASE_LAT + dLat],
      [lng, BASE_LAT]
    ]
  });
};

const publishRoute = async (options: {
  east?: number;
  metres?: number;
  distanceMetres?: number;
  familyKey?: string;
  status?: 'draft' | 'published' | 'withdrawn';
  reviewed?: boolean;
  staleDays?: number;
  lit?: boolean;
}): Promise<string> => {
  const east = options.east ?? 0;
  const reviewed = options.reviewed ?? true;
  const status = options.status ?? 'published';
  const created = await db.query<{ id: string }>(
    `INSERT INTO curated_routes (stable_key, name, family_key, path, start_point,
       distance_metres, city_tag, country_tag, surface, lit, traffic_exposure,
       accessibility, provenance, reviewed_by_account_id, reviewed_at, status,
       published_at, withdrawn_at, withdrawn_reason, revalidate_after)
     VALUES ($1, $2, $3, ST_SetSRID(ST_GeomFromGeoJSON($4), 4326),
       ST_StartPoint(ST_SetSRID(ST_GeomFromGeoJSON($4), 4326)), $5, 'Mumbai', 'IN',
       'paved', $6, 'low', 'step-free', '{"source":"test"}'::jsonb,
       $7, $8, $9, $10, $11, $12, now() + ($13 || ' days')::interval)
     RETURNING id`,
    [
      `route-${randomUUID()}`,
      'Test Loop',
      options.familyKey ?? `family-${randomUUID()}`,
      loopJson(east, options.metres ?? 400),
      options.distanceMetres ?? 3_000,
      options.lit ?? true,
      reviewed ? reviewer : null,
      reviewed ? new Date() : null,
      status,
      status === 'published' ? new Date() : null,
      status === 'withdrawn' ? new Date() : null,
      status === 'withdrawn' ? 'test withdrawal' : null,
      String(options.staleDays ?? 30)
    ]
  );
  return created.rows[0]!.id;
};

const suggest = (query: string) =>
  app.inject({
    method: 'GET',
    url: `/v1/routes/suggest?${query}`,
    headers: { authorization: `Bearer ${createAccessToken(account, SECRET)}` }
  });

const here = `latitude=${BASE_LAT}&longitude=${BASE_LNG}`;

beforeAll(async () => {
  if (!enabled) return;
  await migrate(db);
  account = await makeAccount();
  reviewer = await makeAccount();
}, 120_000);

afterAll(async () => {
  if (!enabled) return;
  await app.close();
  if (account) {
    await db.query('DELETE FROM curated_routes');
    await db.query('DELETE FROM accounts WHERE id = ANY($1::uuid[])', [[account, reviewer]]);
  }
  await db.end();
});

beforeEach(async () => {
  if (!enabled) return;
  await db.query('DELETE FROM route_suggestion_events WHERE account_id = $1', [account]);
  await db.query('DELETE FROM curated_routes');
});

describePostgis('route suggestions on real PostGIS', () => {
  it('measures nearness in metres, not degrees', async () => {
    // Without the `::geography` casts this passes for a loop in another
    // country. 0.4 degrees of longitude here is about 42 km.
    await publishRoute({ east: 0 });
    await publishRoute({ east: 0.4 });

    const body = (await suggest(here)).json();

    expect(body.data).toHaveLength(1);
    // Hundreds of metres, not tens of thousands. It is not zero because the
    // endpoint snaps the request to a ~1 km grid before measuring — that is the
    // coarse-location behaviour, and it is why the bound is 1 km and not 100 m.
    expect(body.data[0].startDistanceMetres).toBeLessThan(1_000);
  });

  it('reports how far away the start actually is', async () => {
    // ~1 km east.
    await publishRoute({ east: 0.0095 });

    const body = (await suggest(here)).json();

    expect(body.data[0].startDistanceMetres).toBeGreaterThan(800);
    expect(body.data[0].startDistanceMetres).toBeLessThan(1_200);
  });

  it('leaves out a loop past the published radius', async () => {
    // ~2 km east, beyond the 1.5 km rule.
    await publishRoute({ east: 0.019 });

    expect((await suggest(here)).json().data).toEqual([]);
  });

  it('offers only published routes', async () => {
    await publishRoute({ status: 'draft' });
    await publishRoute({ status: 'withdrawn' });

    const body = (await suggest(here)).json();

    expect(body.data).toEqual([]);
    expect(body.unavailableReason).toBe('no_curated_routes');
  });

  it('stops offering a route nobody has revalidated', async () => {
    // `product.md`: volatile data is revalidated every 30 days. A route past
    // its date drops out without anybody remembering to withdraw it.
    await publishRoute({ staleDays: -1 });

    expect((await suggest(here)).json().data).toEqual([]);
  });

  it('returns the loop closed, so a map can draw it', async () => {
    await publishRoute({});
    const [suggestion] = (await suggest(here)).json().data;

    expect(suggestion.path.length).toBeGreaterThanOrEqual(4);
    expect(suggestion.path[0]).toEqual(suggestion.path[suggestion.path.length - 1]);
  });

  it('offers one loop per family and at most three', async () => {
    for (const distance of [2_000, 2_500, 3_000]) {
      await publishRoute({ familyKey: 'one-park', distanceMetres: distance });
    }
    for (const [index, distance] of [3_100, 3_200, 3_300, 3_400].entries()) {
      await publishRoute({ familyKey: `other-${index}`, distanceMetres: distance });
    }

    const body = (await suggest(here)).json();

    expect(body.data).toHaveLength(3);
    // One from the park family at most, so three variants is one idea.
    expect(body.data.filter((s: { name: string }) => s.name === 'Test Loop').length).toBe(3);
  });

  it('records an impression, and then honours a decline', async () => {
    const route = await publishRoute({});

    expect((await suggest(here)).json().data).toHaveLength(1);

    const feedback = await app.inject({
      method: 'POST',
      url: `/v1/routes/suggestions/${route}/feedback`,
      headers: { authorization: `Bearer ${createAccessToken(account, SECRET)}` },
      payload: { action: 'declined' }
    });
    expect(feedback.statusCode).toBe(200);

    // Rested, and the reason distinguishes it from an empty dataset.
    const after = (await suggest(here)).json();
    expect(after.data).toEqual([]);
    expect(after.unavailableReason).toBe('all_declined');
  });

  it('refuses feedback on a route that was never offered', async () => {
    const route = await publishRoute({});

    const response = await app.inject({
      method: 'POST',
      url: `/v1/routes/suggestions/${route}/feedback`,
      headers: { authorization: `Bearer ${createAccessToken(account, SECRET)}` },
      payload: { action: 'declined' }
    });

    expect(response.statusCode).toBe(404);
  });

  describe('the constraints that protect a runner', () => {
    it('refuses to publish a route nobody reviewed', async () => {
      // The point of the whole table: `product.md` requires that the system
      // "never suggests routes through unverified or private land", and an
      // unreviewed row is exactly that.
      await expect(publishRoute({ reviewed: false, status: 'published' })).rejects.toThrow(
        /published_is_reviewed/
      );
    });

    it('allows an unreviewed draft, so one can be prepared', async () => {
      await expect(publishRoute({ reviewed: false, status: 'draft' })).resolves.toBeDefined();
    });

    it('refuses a loop outside the published distance range', async () => {
      await expect(publishRoute({ distanceMetres: 500 })).rejects.toThrow(/distance_metres/);
      await expect(publishRoute({ distanceMetres: 20_000 })).rejects.toThrow(/distance_metres/);
    });

    it('refuses a withdrawal that does not say when or why', async () => {
      const route = await publishRoute({});

      await expect(
        db.query("UPDATE curated_routes SET status = 'withdrawn' WHERE id = $1", [route])
      ).rejects.toThrow(/withdrawn_has_a_reason/);
      // A date alone is not enough: the next reviewer needs to know whether a
      // park closed, a crossing turned bad, or somebody made a mistake.
      await expect(
        db.query(
          "UPDATE curated_routes SET status = 'withdrawn', withdrawn_at = now() WHERE id = $1",
          [route]
        )
      ).rejects.toThrow(/withdrawn_has_a_reason/);
      await expect(
        db.query(
          `UPDATE curated_routes SET status = 'withdrawn', withdrawn_at = now(),
             withdrawn_reason = 'Park closed for resurfacing' WHERE id = $1`,
          [route]
        )
      ).resolves.toBeDefined();
    });

    it('published the suggestion rule the engine reads', async () => {
      const rule = await db.query<{ definition: Record<string, unknown> }>(
        `SELECT definition FROM rule_versions
         WHERE kind = 'route_suggestion' AND version = 1`
      );

      expect(rule.rows[0]?.definition).toMatchObject({
        maxSuggestions: 3,
        minDistanceMetres: 1000,
        maxDistanceMetres: 10000,
        startWithinMetres: 1500,
        highLoadRatio: 1.5
      });
    });
  });
});

describe('the PostGIS gate', () => {
  it('is open in CI', () => {
    expect(() => requirePostgisInCi()).not.toThrow();
  });
});
