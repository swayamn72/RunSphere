import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '@runsphere/db';
import { buildApp } from './app.js';
import { createAccessToken } from './auth.js';

/**
 * Territory leaderboards and map events at the route level.
 *
 * The SQL these run is covered by the PostGIS integration suite; what is checked
 * here is everything around it — who may reach each route, what a board says
 * about itself, and the validation on announcing an event.
 *
 * The role gate on event creation is the one to keep: it is the only write in
 * this file, and an ungated one would let any signed-in account draw an area on
 * everybody's map.
 */
const SECRET = 'territory-board-routes-test-secret';
const ME = '00000000-0000-4000-8000-00000000000a';
const RIVAL = '00000000-0000-4000-8000-00000000000b';

interface Stubs {
  roles?: { role: string }[];
  board?: Record<string, unknown>[];
  selfRow?: Record<string, unknown>[];
  events?: Record<string, unknown>[];
  created?: Record<string, unknown>[];
  flags?: Record<string, unknown>[];
  reviewed?: Record<string, unknown>[];
  holders?: Record<string, unknown>[];
}

let stubs: Stubs = {};
let calls: { sql: string; values: readonly unknown[] | undefined }[] = [];

const respond = (sql: string) => {
  if (sql.includes('FROM staff_role_assignments')) return { rows: stubs.roles ?? [] };
  // Checked before the claims branch: the events query counts claims inside an
  // event with a subselect, so a looser order answers the wrong one.
  if (sql.includes('ST_AsGeoJSON(event.boundary)')) return { rows: stubs.events ?? [] };
  if (sql.includes('ORDER BY sum(area_sqm) DESC')) return { rows: stubs.holders ?? [] };
  // The reader's own row is fetched with a narrower query than the page.
  if (sql.includes('AND claim.account_id = $1')) return { rows: stubs.selfRow ?? [] };
  if (sql.includes('FROM territory_claims claim')) return { rows: stubs.board ?? [] };
  if (sql.includes('UPDATE territory_trade_flags')) return { rows: stubs.reviewed ?? [] };
  if (sql.includes('FROM territory_trade_flags')) return { rows: stubs.flags ?? [] };
  if (sql.includes('INSERT INTO territory_events'))
    return { rows: stubs.created ?? [{ id: '00000000-0000-4000-8000-0000000000f1' }] };
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

const boardRow = (overrides: Record<string, unknown> = {}) => ({
  key: RIVAL,
  display_name: 'Ravi',
  cosmetic: { avatarKey: 'orbit-04' },
  club_name: null,
  total_area: '270000',
  claim_count: '3',
  defended_count: '1',
  fastest_seconds: 1662,
  ...overrides
});

describe('GET /v1/territory/leaderboard', () => {
  const read = (query = '') =>
    app.inject({ method: 'GET', url: `/v1/territory/leaderboard${query}`, headers: auth });

  it('needs a token it can verify', async () => {
    const url = '/v1/territory/leaderboard';

    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(400);
    expect(
      (await app.inject({ method: 'GET', url, headers: { authorization: 'Bearer nope' } }))
        .statusCode
    ).toBe(401);
  });

  it('ranks by ground held, and says so', async () => {
    stubs = { board: [boardRow(), boardRow({ key: ME, display_name: 'Me' })] };
    const body = (await read()).json();

    expect(body.entries[0]).toMatchObject({ rank: 1, totalAreaSqm: 270_000 });
    expect(body.entries[1].owner.isSelf).toBe(true);
    // A rank without a stated basis is just a number.
    expect(body.note).toContain('Ground you lose stops counting');
  });

  it('counts only ground still held', async () => {
    await read();

    expect(sql()).toContain('claim.released_at IS NULL');
  });

  it('leaves out anybody under a sharing suspension', async () => {
    await read();

    expect(sql()).toContain('NOT EXISTS (SELECT 1 FROM sanctions');
  });

  it('orders each metric by its own column', async () => {
    await read('?metric=fastest');

    // A board of the quickest loops wants the smallest number first.
    expect(sql()).toContain('fastest_seconds ASC NULLS LAST');
  });

  it('says what a defended board counts', async () => {
    const body = (await read('?metric=defended')).json();

    expect(body.metric).toBe('defended');
    expect(body.note).toContain('kept, not just taken');
  });

  it('groups a club board by club and never presents a club as a person', async () => {
    stubs = { board: [boardRow({ key: 'club-1', club_name: 'Somaiya Run Club' })] };
    const body = (await read('?scope=club')).json();

    expect(body.entries[0].club).toEqual({ id: 'club-1', name: 'Somaiya Run Club' });
    expect(body.entries[0].owner).toBeUndefined();
    expect(sql()).toContain('claim.club_id IS NOT NULL');
  });

  it('fetches the reader own row when it falls outside the page', async () => {
    stubs = { board: [boardRow()], selfRow: [boardRow({ key: ME, display_name: 'Me' })] };
    const body = (await read()).json();

    // A board somebody cannot find themselves on tells them nothing.
    expect(body.self.isSelf).toBe(true);
    expect(body.self.totalAreaSqm).toBe(270_000);
  });

  it('does not look up a self row when the reader is already on the page', async () => {
    stubs = { board: [boardRow({ key: ME, display_name: 'Me' })] };
    const body = (await read()).json();

    expect(body.self).toBeUndefined();
    expect(sql()).not.toContain('AND claim.account_id = $1');
  });

  it('rejects a metric it does not publish', async () => {
    expect((await read('?metric=pace')).statusCode).toBe(400);
  });
});

describe('GET /v1/territory/events', () => {
  const eventRow = (overrides: Record<string, unknown> = {}) => ({
    id: '00000000-0000-4000-8000-0000000000f1',
    title: 'Capture the Park',
    description: 'Hold ground in the park this weekend.',
    starts_at: new Date('2026-09-10T00:00:00.000Z'),
    ends_at: new Date('2026-09-14T00:00:00.000Z'),
    boundary: JSON.stringify({
      type: 'Polygon',
      coordinates: [
        [
          [72.87, 19.07],
          [72.89, 19.07],
          [72.89, 19.09],
          [72.87, 19.07]
        ]
      ]
    }),
    centroid: JSON.stringify({ type: 'Point', coordinates: [72.88, 19.08] }),
    reward: 'A cosmetic badge',
    status: 'live',
    held: '6',
    mine: '2',
    ...overrides
  });

  it('reports how much of an event is the reader own', async () => {
    stubs = { events: [eventRow()] };
    const body = (
      await app.inject({ method: 'GET', url: '/v1/territory/events', headers: auth })
    ).json();

    expect(body.data[0]).toMatchObject({
      title: 'Capture the Park',
      heldClaimCount: 6,
      selfClaimCount: 2,
      reward: 'A cosmetic badge'
    });
    // A count of what is held inside, never a list of who holds it.
    expect(JSON.stringify(body)).not.toContain('account');
  });

  it('drops an event whose geometry did not come back readable', async () => {
    stubs = { events: [eventRow({ boundary: 'not json' })] };
    const body = (
      await app.inject({ method: 'GET', url: '/v1/territory/events', headers: auth })
    ).json();

    expect(body.data).toEqual([]);
  });

  it('shows only events that have not finished', async () => {
    await app.inject({ method: 'GET', url: '/v1/territory/events', headers: auth });

    expect(sql()).toContain("event.status IN ('announced', 'live')");
  });
});

describe('POST /v1/staff/territory/events', () => {
  const boundary = [
    [72.87, 19.07],
    [72.89, 19.07],
    [72.89, 19.09]
  ];
  const announce = (body: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/v1/staff/territory/events', headers: auth, payload: body });

  const valid = {
    title: 'Capture the Park',
    description: 'Hold ground in the park this weekend.',
    startsAt: '2026-09-10T00:00:00.000Z',
    endsAt: '2026-09-14T00:00:00.000Z',
    boundary,
    reward: 'A cosmetic badge'
  };

  it('needs a season operator role', async () => {
    stubs = { roles: [] };
    const response = await announce(valid);

    // The only write in this file. Ungated, any signed-in account could draw an
    // area on everybody's map.
    expect(response.statusCode).toBe(403);
    expect(sql()).not.toContain('INSERT INTO territory_events');
  });

  it('announces an event for an operator, and audits it', async () => {
    stubs = { roles: [{ role: 'season_operator' }] };
    const response = await announce(valid);

    expect(response.statusCode).toBe(201);
    expect(response.json().data[0].status).toBe('announced');
    expect(sql()).toContain("'territory.event_announced'");
  });

  it('refuses an event that ends before it starts', async () => {
    stubs = { roles: [{ role: 'season_operator' }] };
    const response = await announce({
      ...valid,
      startsAt: '2026-09-14T00:00:00.000Z',
      endsAt: '2026-09-10T00:00:00.000Z'
    });

    expect(response.statusCode).toBe(422);
  });

  it('refuses an area too small to be an area', async () => {
    stubs = { roles: [{ role: 'season_operator' }] };

    expect((await announce({ ...valid, boundary: [[72.87, 19.07]] })).statusCode).toBe(400);
  });

  it('closes the ring before storing it', async () => {
    stubs = { roles: [{ role: 'season_operator' }] };
    await announce(valid);

    const insert = calls.find((call) => call.sql.includes('INSERT INTO territory_events'));
    const stored = JSON.parse(String(insert?.values?.[4])) as { coordinates: number[][][] };
    expect(stored.coordinates[0]).toHaveLength(boundary.length + 1);
    expect(stored.coordinates[0]![0]).toEqual(stored.coordinates[0]!.at(-1));
  });
});

describe('claim-trading review', () => {
  const flagRow = (overrides: Record<string, unknown> = {}) => ({
    id: '00000000-0000-4000-8000-0000000000aa',
    lineage_id: '00000000-0000-4000-8000-0000000000bb',
    exchanges: 9,
    pair_share: '1.000',
    first_at: new Date('2026-09-01T00:00:00.000Z'),
    last_at: new Date('2026-09-18T00:00:00.000Z'),
    reviewed_at: null,
    review_outcome: null,
    ...overrides
  });

  const list = () =>
    app.inject({ method: 'GET', url: '/v1/staff/territory/trade-flags', headers: auth });
  const review = (body: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: '/v1/staff/territory/trade-flags/00000000-0000-4000-8000-0000000000aa/review',
      headers: auth,
      payload: body
    });

  it('needs a moderator role to read or decide', async () => {
    stubs = { roles: [] };

    expect((await list()).statusCode).toBe(403);
    expect((await review({ outcome: 'upheld', note: 'Trading.' })).statusCode).toBe(403);
  });

  it('presents a flag as a question rather than a verdict', async () => {
    stubs = { roles: [{ role: 'moderator' }], flags: [flagRow()] };
    const body = (await list()).json();

    expect(body.data[0]).toMatchObject({ exchanges: 9, pairShare: 1 });
    // Two friends racing every week produce the same pattern.
    expect(body.note).toContain('race each other every week');
  });

  it('never names the accounts on the review surface', async () => {
    stubs = { roles: [{ role: 'moderator' }], flags: [flagRow()] };
    const body = (await list()).json();

    // The ground and the numbers are what a reviewer decides on; who they are
    // is a separate lookup, and putting it here would prejudge it. Asserted
    // against the rows, not the whole body: the explanatory note says the word
    // "accounts" on purpose.
    expect(Object.keys(body.data[0])).toEqual([
      'id',
      'lineageId',
      'exchanges',
      'pairShare',
      'firstAt',
      'lastAt'
    ]);
    expect(JSON.stringify(body.data)).not.toContain(ME);
    expect(JSON.stringify(body.data)).not.toContain(RIVAL);
  });

  it('records an upheld decision with its reviewer and audits it', async () => {
    stubs = {
      roles: [{ role: 'moderator' }],
      reviewed: [
        flagRow({ reviewed_at: new Date('2026-09-19T00:00:00.000Z'), review_outcome: 'upheld' })
      ]
    };
    const response = await review({ outcome: 'upheld', note: 'Passed back and forth all month.' });

    expect(response.json().data[0].reviewOutcome).toBe('upheld');
    expect(sql()).toContain("'territory.trade_flag_reviewed'");
  });

  it('is 404 for a flag that no longer exists', async () => {
    stubs = { roles: [{ role: 'moderator' }], reviewed: [] };

    expect((await review({ outcome: 'dismissed', note: 'Genuine rivalry.' })).statusCode).toBe(404);
  });

  it('requires a written reason for either outcome', async () => {
    stubs = { roles: [{ role: 'moderator' }] };

    expect((await review({ outcome: 'upheld', note: '' })).statusCode).toBe(400);
  });

  it('keeps upheld ground off the leaderboards and nothing more', async () => {
    await app.inject({ method: 'GET', url: '/v1/territory/leaderboard', headers: auth });

    // The consequence is the board position and only the board position: the
    // claims stay on the map and neither account is touched.
    expect(sql()).toContain("flag.review_outcome = 'upheld'");
    expect(sql()).not.toContain('DELETE FROM territory_claims');
    expect(sql()).not.toContain('UPDATE accounts');
  });
});

describe('GET /v1/staff/territory/concentration', () => {
  const read = () =>
    app.inject({ method: 'GET', url: '/v1/staff/territory/concentration', headers: auth });

  it('needs a season operator role', async () => {
    stubs = { roles: [] };

    expect((await read()).statusCode).toBe(403);
  });

  it('reports shares and says what they are measured over', async () => {
    stubs = {
      roles: [{ role: 'season_operator' }],
      holders: Array.from({ length: 20 }, () => ({ total_area: '90000' }))
    };
    const body = (await read()).json();

    expect(body.holders).toBe(20);
    expect(body.topHolderShare).toBeCloseTo(0.05, 2);
    // A number whose scope nobody can see is worse than no number.
    expect(body.scopeNote).toContain('no divisions');
    expect(body.scopeNote).toContain('per-city');
  });

  it('reports rather than acts on a breach', async () => {
    stubs = {
      roles: [{ role: 'season_operator' }],
      holders: [
        { total_area: '900000' },
        ...Array.from({ length: 19 }, () => ({ total_area: '100' }))
      ]
    };
    const body = (await read()).json();

    expect(body.breached).toBe(true);
    // Pausing awards and investigating are things people do.
    expect(sql()).not.toContain('UPDATE');
  });
});
