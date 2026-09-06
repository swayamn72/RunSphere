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

const claimRow = (overrides: Record<string, unknown> = {}) => ({
  id: CLAIM,
  account_id: RIVAL,
  display_name: 'Ravi',
  cosmetic: { avatarKey: 'orbit-04' },
  boundary: polygonJson,
  centroid: pointJson,
  area_sqm: 90_000,
  duration_seconds: 600,
  claimed_at: new Date('2026-09-06T05:10:00.000Z'),
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

  it('takes the ground when it beat the holder time', async () => {
    runnable(300, {
      contested: [{ id: CLAIM, account_id: RIVAL, duration_seconds: 900, boundary: polygonJson }]
    });
    const body = (await claim()).json();

    expect(body).toMatchObject({ claimed: true, takenOverCount: 1 });
    expect(sql()).toContain('UPDATE territory_claims SET released_at');
    expect(sql()).toContain('INSERT INTO territory_claim_takeovers');
  });

  it('refuses when the holder was faster, and says how to win it', async () => {
    runnable(900, {
      contested: [{ id: CLAIM, account_id: RIVAL, duration_seconds: 300, boundary: polygonJson }]
    });
    const body = (await claim()).json();

    expect(body).toMatchObject({ claimed: false, refusal: 'slower_than_holder' });
    expect(body.message).toContain('Run it quicker');
    expect(sql()).not.toContain('INSERT INTO territory_claims');
  });

  it('locks the ground it is contesting before deciding', async () => {
    runnable(300, {
      contested: [{ id: CLAIM, account_id: RIVAL, duration_seconds: 900, boundary: polygonJson }]
    });
    await claim();

    // Two runners finishing the same loop together must not both be told they
    // took it.
    const contest = calls.find((call) => call.sql.includes('FOR UPDATE'));
    expect(contest).toBeDefined();
    expect(sql()).toContain('BEGIN');
    expect(sql()).toContain('COMMIT');
  });

  it('records the two times on the takeover, not just the winner', async () => {
    runnable(300, {
      contested: [{ id: CLAIM, account_id: RIVAL, duration_seconds: 900, boundary: polygonJson }]
    });
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
