import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '@runsphere/db';
import { buildApp } from './app.js';
import { createAccessToken } from './auth.js';

/**
 * Route suggestions at the route level.
 *
 * Two things here are worth more than the rest. The **coarse-location**
 * assertions: a client that sends a precise fix must not be able to make the
 * server hold one. And the **empty-dataset** case, which is the state this
 * deployment is actually in — the answer has to explain itself rather than look
 * like a broken feature.
 */
const SECRET = 'route-suggestion-routes-test-secret';
const ME = '00000000-0000-4000-8000-00000000000a';
const ROUTE = '00000000-0000-4000-8000-0000000000f1';
const OTHER = '00000000-0000-4000-8000-0000000000f2';

const lineJson = JSON.stringify({
  type: 'LineString',
  coordinates: [
    [72.84, 19.05],
    [72.845, 19.05],
    [72.845, 19.055],
    [72.84, 19.055],
    [72.84, 19.05]
  ]
});
const pointJson = JSON.stringify({ type: 'Point', coordinates: [72.84, 19.05] });

const routeRow = (overrides: Record<string, unknown> = {}) => ({
  id: ROUTE,
  name: 'Shivaji Park Circuit',
  family_key: 'shivaji-park',
  path: lineJson,
  start_point: pointJson,
  distance_metres: 3_000,
  start_distance_metres: 300,
  surface: 'paved',
  lit: true,
  traffic_exposure: 'low',
  accessibility: 'step-free',
  declined_at: null,
  ...overrides
});

interface Stubs {
  history?: Record<string, unknown>[];
  load?: Record<string, unknown>[];
  routes?: Record<string, unknown>[];
  offered?: Record<string, unknown>[];
}

let stubs: Stubs = {};
let calls: { sql: string; values: readonly unknown[] | undefined }[] = [];

const query = vi.fn(async (sql: string, values?: readonly unknown[]) => {
  calls.push({ sql, values });
  if (sql.includes('FROM activity_submissions') && sql.includes('durationSeconds'))
    return { rows: stubs.history ?? [] };
  if (sql.includes('WITH weekly AS'))
    return { rows: stubs.load ?? [{ recent: null, median: null }] };
  if (sql.includes('FROM curated_routes route')) return { rows: stubs.routes ?? [] };
  if (sql.includes("action = 'shown'")) return { rows: stubs.offered ?? [] };
  return { rows: [] };
});
const database = {
  query,
  connect: vi.fn(async () => ({ query, release: vi.fn() })),
  end: vi.fn(async () => undefined)
} as unknown as Database;

const app = buildApp({ db: database, authSecret: SECRET });
beforeAll(async () => {
  await app.ready();
}, 120_000);
afterAll(async () => {
  await app.close();
});
beforeEach(() => {
  stubs = {};
  calls = [];
});

const auth = { authorization: `Bearer ${createAccessToken(ME, SECRET)}` };

const suggest = (query = 'latitude=19.0512345&longitude=72.8412345') =>
  app.inject({ method: 'GET', url: `/v1/routes/suggest?${query}`, headers: auth });

describe('GET /v1/routes/suggest', () => {
  it('needs a token it can verify', async () => {
    const url = '/v1/routes/suggest?latitude=19&longitude=72';

    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(400);
    expect(
      (await app.inject({ method: 'GET', url, headers: { authorization: 'Bearer nope' } }))
        .statusCode
    ).toBe(401);
  });

  it('rejects a request with no position rather than guessing one', async () => {
    expect((await suggest('longitude=72.84')).statusCode).toBe(400);
    expect((await suggest('latitude=19.05')).statusCode).toBe(400);
  });

  it('snaps the position before it reaches the query', async () => {
    // The client sent 19.0512345 / 72.8412345. What the database sees must be
    // the coarse grid point, so a precise fix cannot become a stored one.
    await suggest('latitude=19.0512345&longitude=72.8412345');

    const nearby = calls.find((call) => call.sql.includes('FROM curated_routes route'));
    expect(nearby?.values?.[0]).toBeCloseTo(19.05, 10);
    expect(nearby?.values?.[1]).toBeCloseTo(72.84, 10);
    expect(JSON.stringify(nearby?.values)).not.toContain('19.0512345');
    expect(JSON.stringify(nearby?.values)).not.toContain('72.8412345');
  });

  it('gives every runner in a square kilometre the same coarse point', async () => {
    await suggest('latitude=19.0489&longitude=72.8434');
    const first = calls.find((call) => call.sql.includes('FROM curated_routes route'))?.values;
    calls = [];
    await suggest('latitude=19.0531&longitude=72.8377');
    const second = calls.find((call) => call.sql.includes('FROM curated_routes route'))?.values;

    expect(first?.slice(0, 2)).toEqual(second?.slice(0, 2));
  });

  it('stores no part of the position', async () => {
    stubs = { routes: [routeRow()] };
    await suggest();

    // The only write is the impression, and it carries a route and an account.
    const writes = calls.filter((call) => call.sql.includes('INSERT INTO'));
    expect(writes).toHaveLength(1);
    expect(JSON.stringify(writes[0]!.values)).not.toContain('19.05');
    expect(JSON.stringify(writes[0]!.values)).not.toContain('72.84');
  });

  it('offers a reviewed loop with what a runner needs to decide', async () => {
    stubs = { routes: [routeRow()] };
    const body = (await suggest()).json();

    expect(body.data[0]).toMatchObject({
      id: ROUTE,
      name: 'Shivaji Park Circuit',
      distanceMetres: 3_000,
      startDistanceMetres: 300,
      surface: 'paved',
      lit: true,
      trafficExposure: 'low',
      accessibility: 'step-free'
    });
    expect(body.data[0].path).toHaveLength(5);
    expect(body.data[0].estimatedSeconds).toBeGreaterThan(0);
  });

  it('only ever reads published, reviewed, still-fresh routes', async () => {
    await suggest();

    const nearby = calls.find((call) => call.sql.includes('FROM curated_routes route'))?.sql ?? '';
    expect(nearby).toContain("route.status = 'published'");
    // `product.md` requires 30-day revalidation; a stale route stops being
    // offered without anybody remembering to withdraw it.
    expect(nearby).toContain('route.revalidate_after > now()');
    expect(nearby).toContain('ST_DWithin');
  });

  it('says why there is nothing, rather than looking broken', async () => {
    // The state this deployment is in: the dataset ships empty.
    const body = (await suggest()).json();

    expect(body.data).toEqual([]);
    expect(body.unavailableReason).toBe('no_curated_routes');
    expect(body.note).toContain('checked by a person');
  });

  it('records the impression itself rather than trusting the client to', async () => {
    stubs = { routes: [routeRow()] };
    await suggest();

    const shown = calls.find((call) => call.sql.includes('INSERT INTO route_suggestion_events'));
    // The action is a literal in the statement, not a bind parameter: the
    // server decides what an impression is called.
    expect(shown?.sql).toContain("'shown'");
    expect(shown?.values).toContain(ROUTE);
    expect(shown?.values).toContain(ME);
  });

  it('records the adjustment when a distance was asked for', async () => {
    stubs = { routes: [routeRow()] };
    await suggest('latitude=19.05&longitude=72.84&targetDistanceKm=5');
    const body = (await suggest('latitude=19.05&longitude=72.84&targetDistanceKm=5')).json();

    expect(body.targetDistanceMetres).toBe(5_000);
    expect(body.targetReason).toBe('you_asked_for_a_distance');
    const shown = calls.find((call) => call.sql.includes('INSERT INTO route_suggestion_events'));
    expect(shown?.values).toContain(5_000);
  });

  it('converts a time budget into a distance', async () => {
    stubs = { routes: [routeRow()] };
    const body = (await suggest('latitude=19.05&longitude=72.84&targetMinutes=30')).json();

    expect(body.targetReason).toBe('you_asked_for_a_time');
    expect(body.targetDistanceMetres).toBeGreaterThan(1_000);
  });

  it('aims shorter after a heavy week, and says so', async () => {
    stubs = {
      routes: [routeRow({ distance_metres: 1_200 })],
      load: [{ recent: '200', median: '100' }]
    };
    const body = (await suggest()).json();

    expect(body.targetReason).toBe('high_recent_load');
    expect(body.data[0].reason).toContain('run a lot this week');
  });

  it('never reads pace when deciding what to offer', async () => {
    await suggest();

    // Pace reaches the estimate only. Nothing in the candidate query orders or
    // filters by it.
    const nearby = calls.find((call) => call.sql.includes('FROM curated_routes route'))?.sql ?? '';
    expect(nearby).not.toMatch(/pace|speed|duration/i);
    // Recent *load* is minutes, which is a volume and not a speed.
    const load = calls.find((call) => call.sql.includes('WITH weekly AS'))?.sql ?? '';
    expect(load).not.toMatch(/distance|pace|speed/i);
  });

  it('drops a loop whose geometry did not come back readable', async () => {
    // A broken line on a map is a route somebody might follow.
    stubs = { routes: [routeRow({ path: 'not json' })] };

    expect((await suggest()).json().data).toEqual([]);
  });

  it('drops a loop whose start did not come back readable', async () => {
    stubs = { routes: [routeRow({ start_point: 'not json' })] };

    expect((await suggest()).json().data).toEqual([]);
  });

  it('says a suggestion is a guide and nothing measures it', async () => {
    stubs = { routes: [routeRow()] };

    expect((await suggest()).json().note).toContain('not a route to follow');
  });

  it('refuses a target distance that is not a number', async () => {
    expect((await suggest('latitude=19.05&longitude=72.84&targetDistanceKm=far')).statusCode).toBe(
      400
    );
  });
});

describe('POST /v1/routes/suggestions/:routeId/feedback', () => {
  const feedback = (action: string, routeId = ROUTE) =>
    app.inject({
      method: 'POST',
      url: `/v1/routes/suggestions/${routeId}/feedback`,
      headers: auth,
      payload: { action }
    });

  it('records a decline, which is the one that changes anything', async () => {
    stubs = { offered: [{ route_id: ROUTE }] };
    const response = await feedback('declined');

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ recorded: true });
    const write = calls.find((call) => call.sql.includes('INSERT INTO route_suggestion_events'));
    expect(write?.values).toContain('declined');
  });

  it('records an acceptance and a completion', async () => {
    for (const action of ['accepted', 'completed']) {
      stubs = { offered: [{ route_id: ROUTE }] };
      calls = [];
      expect((await feedback(action)).statusCode).toBe(200);
      const write = calls.find((call) => call.sql.includes('INSERT INTO route_suggestion_events'));
      expect(write?.values).toContain(action);
    }
  });

  it('refuses feedback on a route the runner was never offered', async () => {
    // Otherwise anybody could write rows against any published route, and those
    // rows decide what gets offered next.
    stubs = { offered: [] };
    const response = await feedback('declined', OTHER);

    expect(response.statusCode).toBe(404);
    expect(calls.some((call) => call.sql.includes('INSERT INTO route_suggestion_events'))).toBe(
      false
    );
  });

  it('refuses an action it does not recognise', async () => {
    stubs = { offered: [{ route_id: ROUTE }] };

    expect((await feedback('loved')).statusCode).toBe(400);
    // `shown` is the server's to write, never the client's.
    expect((await feedback('shown')).statusCode).toBe(400);
  });

  it('needs a token it can verify', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/routes/suggestions/${ROUTE}/feedback`,
      headers: { authorization: 'Bearer nope' },
      payload: { action: 'declined' }
    });

    expect(response.statusCode).toBe(401);
  });
});
