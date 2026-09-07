import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '@runsphere/db';
import { buildApp } from './app.js';
import { createAccessToken } from './auth.js';

/**
 * Enclosure territory claims (milestone 5.1), against a fake database.
 *
 * These tests are mostly about the two things ADR-0011 deliberately changed —
 * the map names people, and a faster loop takes ground — plus the boundary that
 * did *not* move: a suspended account neither claims nor appears.
 *
 * One app is built for the file and stubs are swapped per test, because
 * constructing a Fastify app registers every route in the product and takes
 * seconds on a loaded machine.
 */
const SECRET = 'territory-claim-routes-test-secret';
const ME = '00000000-0000-4000-8000-00000000000a';
const RIVAL = '00000000-0000-4000-8000-00000000000b';
const CLAIM = '00000000-0000-4000-8000-0000000000c1';
const ACTIVITY = '00000000-0000-4000-8000-0000000000d1';

/** A closed 300 m square around a block, as stored trace points. */
const loopPoints = (totalSeconds: number) => {
  const baseLat = 19.076;
  const baseLng = 72.8777;
  const d = 300 / 111_320;
  const corners = [
    [baseLng, baseLat],
    [baseLng + d, baseLat],
    [baseLng + d, baseLat + d],
    [baseLng, baseLat + d]
  ];
  const path: number[][] = [];
  for (let side = 0; side < 4; side += 1) {
    const from = corners[side]!;
    const to = corners[(side + 1) % 4]!;
    for (let step = 0; step < 6; step += 1) {
      const t = step / 6;
      path.push([from[0]! + (to[0]! - from[0]!) * t, from[1]! + (to[1]! - from[1]!) * t]);
    }
  }
  path.push(corners[0]!);
  const start = Date.UTC(2026, 8, 6, 5, 0, 0);
  const gap = (totalSeconds * 1000) / (path.length - 1);
  return path.map(([longitude, latitude], index) => ({
    longitude,
    latitude,
    recordedAt: new Date(start + index * gap).toISOString()
  }));
};

const polygonJson = JSON.stringify({
  type: 'Polygon',
  coordinates: [
    [
      [72.8777, 19.076],
      [72.8804, 19.076],
      [72.8804, 19.0787],
      [72.8777, 19.0787],
      [72.8777, 19.076]
    ]
  ]
});
const pointJson = JSON.stringify({ type: 'Point', coordinates: [72.879, 19.0773] });

/** The same block again, doubled eastward: ~180,000 m² instead of ~90,000. */
const widePolygonJson = JSON.stringify({
  type: 'Polygon',
  coordinates: [
    [
      [72.8777, 19.076],
      [72.8858, 19.076],
      [72.8858, 19.0787],
      [72.8777, 19.0787],
      [72.8777, 19.076]
    ]
  ]
});

const claimRow = (overrides: Record<string, unknown> = {}) => ({
  id: CLAIM,
  account_id: RIVAL,
  display_name: 'Ravi',
  cosmetic: { avatarKey: 'orbit-04' },
  boundary: polygonJson,
  centroid: pointJson,
  area_sqm: 90_000,
  // Four 300 m sides. NOT NULL since `036` — it is the perimeter half of the
  // speed a challenger has to beat.
  distance_metres: 1_200,
  duration_seconds: 600,
  season_month: '2026-09',
  claimed_at: new Date('2026-09-06T05:10:00.000Z'),
  ...overrides
});

/**
 * A claim on the map, as the contest query reads it.
 *
 * `h3_cell_set` is left empty on purpose in most tests: that is what every
 * claim written before `036` looks like, and it makes the route compute the
 * cells from `boundary` inside the transaction — so these tests exercise the
 * real cell arithmetic rather than a hand-written set, and cover the backfill
 * at the same time.
 */
const heldRow = (overrides: Record<string, unknown> = {}) => ({
  id: CLAIM,
  account_id: RIVAL,
  area_sqm: 90_000,
  distance_metres: 1_200,
  duration_seconds: 900,
  capture_count: 1,
  lineage_id: null,
  h3_cell_set: [],
  h3_resolution: 11,
  boundary: polygonJson,
  ...overrides
});

interface Stubs {
  sanctions?: Record<string, unknown>[];
  privacyZones?: Record<string, unknown>[];
  priorClaims?: string;
  activityOwned?: Record<string, unknown>[];
  chunks?: Record<string, unknown>[];
  mapClaims?: Record<string, unknown>[];
  contested?: Record<string, unknown>[];
  inserted?: Record<string, unknown>[];
  profile?: Record<string, unknown>[];
  holderProfiles?: Record<string, unknown>[];
  takeovers?: Record<string, unknown>[];
  summary?: Record<string, unknown>[];
}

let stubs: Stubs = {};
let calls: { sql: string; values: readonly unknown[] | undefined }[] = [];

const respond = (sql: string) => {
  // Matched on the projection, not on 'FROM sanctions': the map query carries
  // a sanctions subquery too, and a looser match would answer the wrong one.
  if (sql.includes('SELECT kind, statement')) return { rows: stubs.sanctions ?? [] };
  if (sql.includes('FROM activity_submissions')) return { rows: stubs.activityOwned ?? [] };
  if (sql.includes('FROM activity_chunks')) return { rows: stubs.chunks ?? [] };
  if (sql.includes('FROM privacy_zones')) return { rows: stubs.privacyZones ?? [] };
  if (sql.includes('count(*)::text AS count FROM territory_claims'))
    return { rows: [{ count: stubs.priorClaims ?? '0' }] };
  if (sql.includes('ST_MakeEnvelope')) return { rows: stubs.mapClaims ?? [] };
  if (sql.includes('FOR UPDATE')) return { rows: stubs.contested ?? [] };
  if (sql.includes('INSERT INTO territory_claims'))
    return { rows: stubs.inserted ?? [claimRow({ account_id: ME, display_name: null })] };
  // Checked before the single-account read below, because the carve path asks
  // for every holder's display identity in one query and both match on
  // 'FROM profiles WHERE account_id'.
  if (sql.includes('account_id = ANY($1)'))
    return {
      rows: stubs.holderProfiles ?? [
        { account_id: RIVAL, display_name: 'Ravi', cosmetic: { avatarKey: 'orbit-04' } }
      ]
    };
  if (sql.includes('FROM profiles WHERE account_id'))
    return { rows: stubs.profile ?? [{ display_name: 'Me', cosmetic: { avatarKey: 'orbit-01' } }] };
  if (sql.includes('FROM territory_claim_takeovers')) return { rows: stubs.takeovers ?? [] };
  if (sql.includes('count(*) FILTER')) return { rows: stubs.summary ?? [] };
  return { rows: [] };
};

const query = vi.fn(async (sql: string, values?: readonly unknown[]) => {
  calls.push({ sql, values });
  return respond(sql);
});
const client = { query, release: vi.fn() };
const database = {
  query,
  connect: vi.fn(async () => client),
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

const sql = () => calls.map((call) => call.sql).join('\n');
const auth = { authorization: `Bearer ${createAccessToken(ME, SECRET)}` };
const MAP_URL = '/v1/territory/claims?west=72.8&south=19&east=72.95&north=19.15';

describe('GET /v1/territory/claims', () => {
  const read = () => app.inject({ method: 'GET', url: MAP_URL, headers: auth });

  it('needs a token it can verify', async () => {
    expect((await app.inject({ method: 'GET', url: MAP_URL })).statusCode).toBe(400);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: MAP_URL,
          headers: { authorization: 'Bearer nonsense' }
        })
      ).statusCode
    ).toBe(401);
  });

  it('names the holder and shows the time to beat', async () => {
    stubs = { mapClaims: [claimRow()] };
    const body = (await read()).json();

    // ADR-0011: this map is supposed to say who holds what. That is the
    // reversal, and it is asserted rather than left implied.
    expect(body.claims[0].owner).toEqual({
      id: RIVAL,
      displayName: 'Ravi',
      avatarKey: 'orbit-04',
      isSelf: false
    });
    expect(body.claims[0].durationSeconds).toBe(600);
    expect(body.claims[0].boundary.length).toBeGreaterThanOrEqual(3);
  });

  it('marks the reader own ground', async () => {
    stubs = { mapClaims: [claimRow({ account_id: ME })] };

    expect((await read()).json().claims[0].owner.isSelf).toBe(true);
  });

  it('leaves out anybody under a sharing suspension', async () => {
    await read();

    // A name on a public map is exactly the visibility a suspension pauses.
    expect(sql()).toContain('NOT EXISTS (SELECT 1 FROM sanctions');
  });

  it('reads only the viewport it was asked for', async () => {
    await read();

    const envelope = calls.find((call) => call.sql.includes('ST_MakeEnvelope'));
    expect(envelope?.values?.slice(0, 4)).toEqual([72.8, 19, 72.95, 19.15]);
  });

  it('says when it had to stop rather than showing a fraction of the ground', async () => {
    stubs = { mapClaims: Array.from({ length: 401 }, () => claimRow()) };
    const body = (await read()).json();

    expect(body.truncated).toBe(true);
    expect(body.claims).toHaveLength(400);
  });

  it('drops a row whose geometry did not come back readable', async () => {
    stubs = { mapClaims: [claimRow({ boundary: 'not json' })] };

    expect((await read()).json().claims).toEqual([]);
  });

  it('shows this season ground and not a finished one', async () => {
    await read();

    const envelope = calls.find((call) => call.sql.includes('ST_MakeEnvelope'));
    expect(envelope?.sql).toContain('claim.season_month = $6');
  });

  it('says what the map records about people', async () => {
    expect((await read()).json().mapNote).toContain('the holder’s name');
  });

  it('rejects a half-specified viewport rather than guessing one', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/territory/claims?west=72.8&south=19',
      headers: auth
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('POST /v1/territory/claims', () => {
  const claim = () =>
    app.inject({
      method: 'POST',
      url: '/v1/territory/claims',
      headers: auth,
      payload: { activityId: ACTIVITY }
    });

  const runnable = (totalSeconds: number, extra: Stubs = {}) => {
    stubs = {
      activityOwned: [{ id: ACTIVITY }],
      chunks: [{ payload: { points: loopPoints(totalSeconds) } }],
      ...extra
    };
  };

  it('is 404 for a run that is not this account own, derived, and unpurged', async () => {
    stubs = { activityOwned: [] };

    expect((await claim()).statusCode).toBe(404);
  });

  it('is refused while sharing is suspended', async () => {
    stubs = {
      sanctions: [
        {
          kind: 'social_suspension',
          statement: 'Paused for a week after a report.',
          expires_at: null,
          revoked_at: null
        }
      ]
    };
    const response = await claim();

    // Claiming puts a name on a public map, so it is a publishing act.
    expect(response.statusCode).toBe(403);
    expect(response.json().message).toContain('Paused for a week');
  });

  it('explains a run that was not a loop, and does not call it an error', async () => {
    stubs = {
      activityOwned: [{ id: ACTIVITY }],
      chunks: [
        {
          payload: {
            // An out-and-back at a plausible pace: not a loop, and nothing
            // about it should trip the integrity check either.
            points: Array.from({ length: 30 }, (_unused, index) => ({
              latitude: 19.076 + index * 0.0002,
              longitude: 72.8777 + (index % 2 === 0 ? 0.00002 : -0.00002),
              recordedAt: new Date(Date.UTC(2026, 8, 6, 5, 0, index * 10)).toISOString()
            }))
          }
        }
      ]
    };
    const response = await claim();

    // Most runs are not loops. That is an ordinary outcome with words to show,
    // not a failure the app has to translate from a status code.
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ claimed: false, refusal: 'not_closed' });
    expect(response.json().message).toContain('Finish near the point you began');
  });

  it('refuses a trace that could not have been run, and records it for review', async () => {
    stubs = {
      activityOwned: [{ id: ACTIVITY }],
      chunks: [
        {
          payload: {
            // 3 km dead straight at 11 m/s: a vehicle, not a runner.
            points: Array.from({ length: 30 }, (_unused, index) => ({
              latitude: 19.076 + index * 0.001,
              longitude: 72.8777,
              recordedAt: new Date(Date.UTC(2026, 8, 6, 5, 0, index * 10)).toISOString()
            }))
          }
        }
      ]
    };
    const response = await claim();

    expect(response.json()).toMatchObject({ claimed: false, refusal: 'run_integrity' });
    // Flagged for a human, never punished: bad GPS looks the same as cheating.
    expect(sql()).toContain('INSERT INTO run_integrity_flags');
    expect(sql()).not.toContain('INSERT INTO territory_claims');
    expect(response.json().message).not.toMatch(/cheat|ban|suspend/i);
  });

  it('refuses a loop that passes through the runner own private area', async () => {
    runnable(600, { privacyZones: [{ zone_id: 'zone-1' }] });
    const response = await claim();

    // ADR-0002: zones apply before any activity geometry is shared, and a
    // boundary is shared geometry. A polygon cannot be partly published, so
    // the only correct answer is to refuse the claim.
    expect(response.json()).toMatchObject({ claimed: false, refusal: 'privacy_zone' });
    expect(response.json().message).toContain('run itself is saved');
    expect(sql()).not.toContain('INSERT INTO territory_claims');
  });

  it('checks zones against the claimant own account, not everybody', async () => {
    runnable(600);
    await claim();

    // A zone protects its owner's route from publication. Somebody else's zone
    // is not a reason this runner cannot hold ground they ran through.
    const zoneQuery = calls.find((call) => call.sql.includes('FROM privacy_zones'));
    expect(zoneQuery?.values?.[0]).toBe(ME);
    expect(zoneQuery?.sql).toContain('zone.account_id = $1');
  });

  it('stores a ring that does not say where the run started', async () => {
    runnable(600);
    await claim();

    // The first coordinate of a loop run from home is the front door, so the
    // stored ring starts at a vertex chosen by geography instead.
    const insert = calls.find((call) => call.sql.includes('INSERT INTO territory_claims'));
    const stored = JSON.parse(String(insert?.values?.[2])) as {
      coordinates: number[][][];
    };
    const ring = stored.coordinates[0]!;
    const west = Math.min(...ring.map((pair) => pair[0]!));
    expect(ring[0]![0]).toBe(west);
  });

  it('claims open ground and says nobody held it', async () => {
    runnable(600);
    const body = (await claim()).json();

    expect(body).toMatchObject({ claimed: true, takenOverCount: 0 });
    expect(body.message).toContain('Nobody held it');
    expect(sql()).toContain('INSERT INTO territory_claims');
  });

  it('says when a claim is an account first, so the app can warn once', async () => {
    runnable(600);

    // A privacy zone only protects somebody who made one, and the app asks
    // everybody once rather than inferring where anyone lives.
    expect((await claim()).json().isFirstClaim).toBe(true);
  });

  it('does not repeat the warning for somebody who already holds ground', async () => {
    runnable(600, { priorClaims: '4' });

    expect((await claim()).json().isFirstClaim).toBe(false);
  });

  it('stores the cells it holds, the library that produced them, and the season', async () => {
    runnable(600);
    await claim();

    const insert = calls.find((call) => call.sql.includes('INSERT INTO territory_claims'));
    expect(insert?.sql).toContain('h3_cell_set');
    // Reproducibility (ADR-0001): the pinned version travels with the claim so
    // a disputed carve can be recomputed by the code that decided it.
    expect(insert?.values).toContain('4.1.0');
    expect(insert?.values).toContain(11);
    expect(insert?.values?.some((value) => /^\d{4}-\d{2}$/.test(String(value)))).toBe(true);
  });

  it('takes the whole claim when nothing defensible is left of it', async () => {
    // The two loops are the same block, so the holder keeps no connected
    // remainder above the 5,000 m2 floor and the claim is released whole.
    runnable(300, { contested: [heldRow()] });
    const body = (await claim()).json();

    expect(body).toMatchObject({ claimed: true, takenOverCount: 1 });
    expect(sql()).toContain('UPDATE territory_claims SET released_at');
    expect(sql()).toContain('INSERT INTO territory_claim_takeovers');
    expect(body.carves[0]).toMatchObject({ carved: true, holderWipedOut: true });
  });

  it('carves the shared part and leaves the holder the rest', async () => {
    // The mechanic ADR-0011 v3 asks for, and the one the old rule could not do:
    // the holder loses the half that was run and keeps the half that was not.
    runnable(300, {
      contested: [heldRow({ boundary: widePolygonJson, area_sqm: 180_000 })]
    });
    const body = (await claim()).json();

    expect(body.takenOverCount).toBe(1);
    expect(body.carves[0]).toMatchObject({ carved: true, holderWipedOut: false });
    expect(body.carvedAreaSqm).toBeGreaterThan(50_000);
    // Their ground is rewritten, not released: the map must not keep showing
    // somebody territory they no longer hold.
    expect(sql()).toContain('SET h3_cell_set');
    expect(sql()).not.toContain('UPDATE territory_claims SET released_at');
  });

  it('leaves the holder time and distance alone when it carves them', async () => {
    runnable(300, {
      contested: [heldRow({ boundary: widePolygonJson, area_sqm: 180_000 })]
    });
    await claim();

    // Their perimeter and duration record the run they did. Rewriting either
    // would change a speed somebody has already been measured against.
    const update = calls.find((call) =>
      call.sql.includes('SET h3_cell_set = $2::text[], area_sqm')
    );
    expect(update).toBeDefined();
    expect(update?.sql).not.toContain('duration_seconds');
    expect(update?.sql).not.toContain('distance_metres');
  });

  it('publishes both speeds and the grace behind the verdict', async () => {
    runnable(300, { contested: [heldRow()] });
    const [carve] = (await claim()).json().carves;

    // The challenger's perimeter comes from the trace — ~1,167 m, because the
    // loop is measured between the two points that closed it and not around
    // the drawn polygon — over 300 s. The holder's is the stored 1,200 m over
    // 900 s. Same loop length either way, so no grace is earned.
    expect(carve.yourSpeedMps).toBeGreaterThan(3.8);
    expect(carve.yourSpeedMps).toBeLessThan(4);
    expect(carve.theirSpeedMps).toBeCloseTo(1.33, 1);
    expect(carve.graceApplied).toBe(0);
    expect(carve.effectiveSpeedMps).toBe(carve.yourSpeedMps);
    expect(carve.holder.displayName).toBe('Ravi');
  });

  it('refuses when the holder was faster, and says how to win it', async () => {
    runnable(900, { contested: [heldRow({ duration_seconds: 300 })] });
    const body = (await claim()).json();

    expect(body).toMatchObject({ claimed: false, refusal: 'slower_than_holder' });
    // Time is no longer what gets compared, so the words must not promise it is.
    expect(body.message).toContain('speed');
    expect(sql()).not.toContain('INSERT INTO territory_claims (');
  });

  it('records a failed challenge with the numbers it lost by', async () => {
    runnable(900, { contested: [heldRow({ duration_seconds: 300 })] });
    const body = (await claim()).json();

    // A defence is what lets a territory say how often it has been *held*, not
    // only how often it changed hands.
    const attempt = calls.find((call) => call.sql.includes('INSERT INTO territory_claim_attempts'));
    expect(attempt?.sql).toContain('effective_speed_mps');
    expect(attempt?.values).toContain('slower');
    expect(body.carves[0]).toMatchObject({ carved: false, overlapTooSmall: false });
  });

  it('computes the cells for a claim written before carving existed', async () => {
    // A pre-036 claim has no cell set. Left alone it would be invisible to the
    // contest, and anybody could claim straight over it.
    runnable(300, { contested: [heldRow({ h3_cell_set: [] })] });
    await claim();

    const repair = calls.find((call) =>
      call.sql.includes('SET h3_cell_set = $2::text[], h3_resolution')
    );
    expect(repair).toBeDefined();
    expect(repair?.values?.[0]).toBe(CLAIM);
  });

  it('finds ground to contest by cells and by outline, so no claim is missed', async () => {
    runnable(300, { contested: [heldRow()] });
    await claim();

    const contest = calls.find((call) => call.sql.includes('FOR UPDATE'));
    expect(contest?.sql).toContain('h3_cell_set && $1::text[]');
    expect(contest?.sql).toContain('claim.boundary &&');
  });

  it('only contests ground held in the current season', async () => {
    runnable(300, { contested: [heldRow()] });
    await claim();

    // A finished month is history. The reset job archives it; this filter is
    // what makes the month boundary correct before that job has run.
    const contest = calls.find((call) => call.sql.includes('FOR UPDATE'));
    expect(contest?.sql).toContain('claim.season_month = $3');
  });

  it('locks the ground it is contesting before deciding', async () => {
    runnable(300, { contested: [heldRow()] });
    await claim();

    // Two runners finishing the same loop together must not both be told they
    // took it.
    const contest = calls.find((call) => call.sql.includes('FOR UPDATE'));
    expect(contest).toBeDefined();
    expect(sql()).toContain('BEGIN');
    expect(sql()).toContain('COMMIT');
  });

  it('records the two times on the takeover, not just the winner', async () => {
    runnable(300, { contested: [heldRow()] });
    await claim();

    const takeover = calls.find((call) =>
      call.sql.includes('INSERT INTO territory_claim_takeovers')
    );
    expect(takeover?.values).toContain(900);
    expect(takeover?.values).toContain(RIVAL);
  });
});

describe('GET /v1/territory/claims/activity', () => {
  it('tells somebody who took their ground and by how much', async () => {
    stubs = {
      takeovers: [
        {
          id: '00000000-0000-4000-8000-0000000000e1',
          taken_from_account_id: ME,
          taken_by_account_id: RIVAL,
          rival_id: RIVAL,
          rival_name: 'Ravi',
          rival_cosmetic: { avatarKey: 'orbit-04' },
          previous_duration_seconds: 900,
          new_duration_seconds: 720,
          created_at: new Date('2026-09-06T06:00:00.000Z')
        }
      ]
    };
    const body = (
      await app.inject({ method: 'GET', url: '/v1/territory/claims/activity', headers: auth })
    ).json();

    // Losing ground silently is the fastest way to make this feel broken.
    expect(body.data[0]).toMatchObject({
      takenFromSelf: true,
      previousDurationSeconds: 900,
      newDurationSeconds: 720
    });
    expect(body.data[0].rival.displayName).toBe('Ravi');
  });

  it('still reports the event after the other account is erased', async () => {
    stubs = {
      takeovers: [
        {
          id: '00000000-0000-4000-8000-0000000000e2',
          taken_from_account_id: ME,
          taken_by_account_id: null,
          rival_id: null,
          rival_name: null,
          rival_cosmetic: null,
          previous_duration_seconds: 900,
          new_duration_seconds: 700,
          created_at: new Date('2026-09-06T06:00:00.000Z')
        }
      ]
    };
    const body = (
      await app.inject({ method: 'GET', url: '/v1/territory/claims/activity', headers: auth })
    ).json();

    expect(body.data[0].rival).toBeUndefined();
    expect(body.data[0].takenFromSelf).toBe(true);
  });
});

describe('GET /v1/territory/claims/summary', () => {
  it('reports ground held and ground lost, and no rank', async () => {
    stubs = { summary: [{ claim_count: '3', total_area: '270000', lost_count: '1' }] };
    const body = (
      await app.inject({ method: 'GET', url: '/v1/territory/claims/summary', headers: auth })
    ).json();

    expect(body).toEqual({ claimCount: 3, totalAreaSqm: 270_000, lostCount: 1 });
    // Divisions and ladders belong to the cell engine, not to this mechanic.
    expect(Object.keys(body)).not.toContain('rank');
  });

  it('is zero rather than empty for somebody who holds nothing', async () => {
    stubs = { summary: [] };
    const body = (
      await app.inject({ method: 'GET', url: '/v1/territory/claims/summary', headers: auth })
    ).json();

    expect(body).toEqual({ claimCount: 0, totalAreaSqm: 0, lostCount: 0 });
  });
});
