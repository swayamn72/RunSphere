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
  place?: Record<string, unknown>[];
  snapshots?: Record<string, unknown>[];
  seasons?: Record<string, unknown>[];
  records?: Record<string, unknown>[];
  recap?: Record<string, unknown>[];
}

let stubs: Stubs = {};
let calls: { sql: string; values: readonly unknown[] | undefined }[] = [];

const respond = (sql: string) => {
  if (sql.includes('FROM staff_role_assignments')) return { rows: stubs.roles ?? [] };
  // The place inference reads a tag column aliased as `scope_key`, which no
  // other query in this file does. Checked first for that reason.
  if (sql.includes('AS scope_key') && sql.includes('FROM territory_claims'))
    return { rows: stubs.place ?? [] };
  if (sql.includes('FROM territory_claim_season_snapshots') && sql.includes("kind = 'final'"))
    return { rows: stubs.recap ?? stubs.snapshots ?? [] };
  if (sql.includes('FROM territory_claim_season_snapshots')) return { rows: stubs.snapshots ?? [] };
  if (sql.includes('FROM territory_claim_seasons')) return { rows: stubs.seasons ?? [] };
  if (sql.includes('FROM territory_claim_hall_of_fame record'))
    return { rows: stubs.records ?? [] };
  if (sql.includes('FROM territory_claim_hall_of_fame')) return { rows: stubs.records ?? [] };
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

const snapshotRow = (overrides: Record<string, unknown> = {}) => ({
  account_id: RIVAL,
  display_name: 'Ravi',
  cosmetic: { avatarKey: 'orbit-04' },
  total_area_sqm: 48_200,
  claim_count: 4,
  rank: 1,
  ...overrides
});

describe('leaderboard scopes and periods', () => {
  const read = (query = '') =>
    app.inject({ method: 'GET', url: `/v1/territory/leaderboard${query}`, headers: auth });

  it('scopes the live board to a named city', async () => {
    stubs = { board: [boardRow()] };
    const body = (await read('?scope=city&scopeKey=Mumbai')).json();

    expect(body.scope).toBe('city');
    expect(body.scopeKey).toBe('Mumbai');
    expect(sql()).toContain('claim.city_tag = $3');
    const page = calls.find((call) => call.sql.includes('claim.city_tag = $3'));
    expect(page?.values).toContain('Mumbai');
  });

  it('works out the reader own city when none is named', async () => {
    // What the app My City tab asks for: no city picker, no list of every city
    // on earth. Their own held ground says where they run.
    stubs = { place: [{ scope_key: 'Mumbai' }], board: [boardRow()] };
    const body = (await read('?scope=city')).json();

    expect(body.scopeKey).toBe('Mumbai');
    expect(body.scopeInferred).toBe(true);
  });

  it('says it does not know where somebody runs, rather than showing an empty city', async () => {
    // Distinct from a city with nobody on it: one is "we have no idea", the
    // other is "you are first".
    stubs = { place: [] };
    const body = (await read('?scope=city')).json();

    expect(body.unavailableReason).toBe('no_place_yet');
    expect(body.entries).toEqual([]);
  });

  it('scopes to a country by its code', async () => {
    stubs = { board: [boardRow()] };
    await read('?scope=country&scopeKey=IN');

    expect(sql()).toContain('claim.country_tag = $3');
  });

  it('puts everybody on the global board, tagged or not', async () => {
    stubs = { board: [boardRow()] };
    const body = (await read('?scope=global')).json();

    expect(body.scope).toBe('global');
    expect(body.scopeKey).toBeUndefined();
    // No place filter at all: untagged ground is still held ground.
    expect(sql()).not.toContain('claim.city_tag =');
    expect(sql()).not.toContain('claim.country_tag =');
  });

  it('reads a week from the frozen snapshot, not from live claims', async () => {
    // A live board recomputed on every read is this moment, not this week, and
    // a runner refreshing it twice would see two different positions.
    stubs = { snapshots: [snapshotRow()] };
    const body = (await read('?scope=global&period=week')).json();

    expect(body.period).toBe('week');
    expect(body.entries[0]).toMatchObject({ rank: 1, totalAreaSqm: 48_200 });
    expect(sql()).toContain('FROM territory_claim_season_snapshots');
    expect(body.note).toContain('does not move until next Monday');
  });

  it('reads a finished season from its final snapshot', async () => {
    stubs = { snapshots: [snapshotRow()] };
    const body = (await read('?scope=global&seasonMonth=2026-08')).json();

    expect(body.seasonMonth).toBe('2026-08');
    expect(sql()).toContain("kind = 'final'");
    expect(body.note).toContain('2026-08');
  });

  it('scopes every live board to the season being played', async () => {
    stubs = { board: [boardRow()] };
    await read();

    // Ground from a finished month is history, not a standing.
    expect(sql()).toContain('claim.season_month = $2');
  });

  it('refuses a season month that is not one', async () => {
    expect((await read('?seasonMonth=August')).statusCode).toBe(400);
  });

  it('refuses a scope it does not have', async () => {
    expect((await read('?scope=planet')).statusCode).toBe(400);
  });
});

describe('GET /v1/territory/leaderboard/seasons', () => {
  const read = () =>
    app.inject({
      method: 'GET',
      url: '/v1/territory/leaderboard/seasons',
      headers: auth
    });

  it('lists the seasons and marks the one being played', async () => {
    stubs = {
      seasons: [
        {
          season_month: '2026-09',
          started_at: new Date('2026-09-01T00:00:00.000Z'),
          ended_at: null,
          claims_archived: 0
        },
        {
          season_month: '2026-08',
          started_at: new Date('2026-08-01T00:00:00.000Z'),
          ended_at: new Date('2026-09-01T00:00:00.000Z'),
          claims_archived: 12
        }
      ]
    };
    const body = (await read()).json();

    expect(body.data[1]).toMatchObject({ seasonMonth: '2026-08', claimsArchived: 12 });
    expect(body.data.filter((season: { isCurrent: boolean }) => season.isCurrent)).toHaveLength(1);
  });

  it('says when the current season resets, so no client needs timezone rules', async () => {
    const body = (await read()).json();

    // 00:01 Asia/Kolkata on the 1st is 18:31 UTC on the last day of the month.
    expect(body.currentSeasonEndsAt).toMatch(/T18:31:00/);
    expect(body.currentSeasonMonth).toMatch(/^\d{4}-\d{2}$/);
  });

  it('needs a token it can verify', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/territory/leaderboard/seasons',
      headers: { authorization: 'Bearer nope' }
    });

    expect(response.statusCode).toBe(401);
  });
});

describe('GET /v1/territory/leaderboard/hall-of-fame', () => {
  const read = (query = '') =>
    app.inject({
      method: 'GET',
      url: `/v1/territory/leaderboard/hall-of-fame${query}`,
      headers: auth
    });

  const record = (overrides: Record<string, unknown> = {}) => ({
    record_type: 'largest_holding',
    value_sqm: 91_000,
    display_name: 'Dev S.',
    account_id: RIVAL,
    cosmetic: { avatarKey: 'orbit-04' },
    season_month: '2026-08',
    achieved_at: new Date('2026-08-20T00:00:00.000Z'),
    ...overrides
  });

  it('names the record, the holder, and what it counts', async () => {
    stubs = { place: [{ scope_key: 'Mumbai' }], records: [record()] };
    const body = (await read()).json();

    expect(body.entries[0]).toMatchObject({
      recordType: 'largest_holding',
      valueSqm: 91_000,
      displayName: 'Dev S.',
      seasonMonth: '2026-08'
    });
    expect(body.entries[0].note).toContain('most ground');
  });

  it('still reads after the account that set it is erased', async () => {
    // The run happened either way, so the name is stored on the record rather
    // than joined from an account that may be gone.
    stubs = {
      place: [{ scope_key: 'Mumbai' }],
      records: [record({ account_id: null, cosmetic: null })]
    };
    const body = (await read()).json();

    expect(body.entries[0].displayName).toBe('Dev S.');
    expect(body.entries[0].owner).toBeUndefined();
  });

  it('drops a record type it does not recognise rather than failing the read', async () => {
    stubs = { place: [{ scope_key: 'Mumbai' }], records: [record({ record_type: 'invented' })] };

    expect((await read()).json().entries).toEqual([]);
  });

  it('says it does not know where somebody runs', async () => {
    stubs = { place: [] };
    const body = (await read()).json();

    expect(body.unavailableReason).toBe('no_place_yet');
  });

  it('needs no place for the global records', async () => {
    stubs = { records: [record()] };
    const body = (await read('?scope=global')).json();

    expect(body.scope).toBe('global');
    expect(body.scopeKey).toBeUndefined();
    const query = calls.find((call) => call.sql.includes('territory_claim_hall_of_fame'));
    expect(query?.values).toContain('GLOBAL');
  });

  it('is honest about having no records yet', async () => {
    stubs = { records: [] };
    const body = (await read('?scope=global')).json();

    expect(body.entries).toEqual([]);
    expect(body.note).toContain('No records here yet');
  });
});

describe('GET /v1/territory/leaderboard/recap', () => {
  const read = () =>
    app.inject({ method: 'GET', url: '/v1/territory/leaderboard/recap', headers: auth });

  it('says there is nothing to recap before any season has ended', async () => {
    stubs = { seasons: [] };

    expect((await read()).json().unavailableReason).toBe('no_finished_season');
  });

  it('says so plainly when they held nothing', async () => {
    // A full-screen card reading "you finished nowhere with no ground" is worse
    // than no card.
    stubs = { seasons: [{ season_month: '2026-08' }], recap: [] };

    expect((await read()).json().unavailableReason).toBe('held_nothing');
  });

  it('reports the peak, the rank, and the city', async () => {
    stubs = {
      seasons: [{ season_month: '2026-08' }],
      recap: [
        {
          scope: 'city',
          scope_key: 'Mumbai',
          rank: 4,
          total_area_sqm: 20_000,
          peak_area_sqm: 48_200,
          claim_count: 4,
          longest_held_days: 18
        }
      ],
      records: []
    };
    const body = (await read()).json();

    expect(body.recap).toMatchObject({
      seasonMonth: '2026-08',
      rank: 4,
      cityTag: 'Mumbai',
      // Peak, not final: the month is remembered by the most they held.
      peakAreaSqm: 48_200,
      finalAreaSqm: 20_000,
      longestHeldDays: 18
    });
  });

  it('prefers the city standing over the global one', async () => {
    stubs = { seasons: [{ season_month: '2026-08' }], recap: [], records: [] };
    await read();

    const query = calls.find((call) => call.sql.includes("kind = 'final'"));
    expect(query?.sql).toContain("CASE scope WHEN 'city' THEN 0");
  });
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
