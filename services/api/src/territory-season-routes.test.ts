import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '@runsphere/db';
import { buildApp } from './app.js';
import { createAccessToken } from './auth.js';

/**
 * The ladder, concentration monitoring, and week rollback (milestones 4.4 and
 * 4.6), against a fake database. Territory capture is off, so in a real
 * deployment every one of these reads is empty; what the tests hold is the
 * shape they will have when it is not.
 *
 * One app is built for the whole file and the stubs are swapped per test.
 * Building a Fastify app registers every route in the product and costs one to
 * three seconds, so twenty of them put individual tests within reach of the
 * default five-second timeout for no benefit.
 */
const SECRET = 'territory-season-routes-test-secret';
const ME = '00000000-0000-4000-8000-00000000000a';
const OTHER = '00000000-0000-4000-8000-00000000000b';
const SEASON = '00000000-0000-4000-8000-0000000000b1';
const WEEK = '2026-09-07';

interface Stubs {
  roles?: { role: string }[];
  seasonExists?: boolean;
  enrollment?: Record<string, unknown>[];
  ladder?: Record<string, unknown>[];
  concentration?: Record<string, unknown>[];
  weeks?: Record<string, unknown>[];
  weekState?: Record<string, unknown>[];
  snapshotCount?: string;
  latestVersion?: number;
}

let stubs: Stubs = {};
let calls: { sql: string; values: readonly unknown[] | undefined }[] = [];

const respond = (sql: string) => {
  if (sql.includes('FROM staff_role_assignments')) return { rows: stubs.roles ?? [] };
  if (sql.includes('SELECT id FROM territory_seasons'))
    return { rows: stubs.seasonExists === false ? [] : [{ id: SEASON }] };
  if (sql.includes('SELECT division FROM territory_enrollments'))
    return { rows: stubs.enrollment ?? [] };
  if (sql.includes('WITH ranked AS')) return { rows: stubs.ladder ?? [] };
  if (sql.includes('FROM territory_concentration_checks'))
    return { rows: stubs.concentration ?? [] };
  if (sql.includes('FROM territory_week_state state')) return { rows: stubs.weeks ?? [] };
  if (sql.includes('FROM territory_week_state')) return { rows: stubs.weekState ?? [] };
  if (sql.includes('count(*)::text AS count FROM territory_cell_control'))
    return { rows: [{ count: stubs.snapshotCount ?? '4' }] };
  if (sql.includes('max(version)')) return { rows: [{ latest_version: stubs.latestVersion ?? 3 }] };
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
// Registering every route in the product is slow on a cold module graph, and
// whichever test injected first would otherwise pay for it and sit near the
// default five-second limit. Warming up here is a one-off setup cost with its
// own allowance; the per-test timeout stays where it is, so a test that becomes
// slow still says so.
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
/** Everything a season operator can reach; individual tests narrow it. */
const asOperator = (extra: Stubs = {}) => {
  stubs = { roles: [{ role: 'season_operator' }], ...extra };
};

describe('GET /v1/territory/seasons/:seasonId/ladder', () => {
  const url = `/v1/territory/seasons/${SEASON}/ladder`;
  const read = () => app.inject({ method: 'GET', url, headers: auth });

  it('needs a token, and rejects one it cannot verify', async () => {
    // A missing header fails the route's own header schema before any handler
    // runs; a header the server cannot verify reaches the handler and is 401.
    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(400);
    expect(
      (await app.inject({ method: 'GET', url, headers: { authorization: 'Bearer nonsense' } }))
        .statusCode
    ).toBe(401);
  });

  it('is 404 for a season that does not exist', async () => {
    stubs = { seasonExists: false };

    expect((await read()).statusCode).toBe(404);
  });

  it('gives somebody who has not joined an empty ladder rather than an error', async () => {
    stubs = { enrollment: [] };
    const response = await read();

    expect(response.statusCode).toBe(200);
    const body = response.json();
    // Not having joined is an ordinary state of the screen, and divisions are
    // isolated, so there is genuinely nothing they are entitled to see.
    expect(body).toMatchObject({ entries: [], participantCount: 0 });
    expect(body.division).toBeUndefined();
    expect(sql()).not.toContain('WITH ranked AS');
  });

  it('never returns an identity, only ranks and points', async () => {
    stubs = {
      enrollment: [{ division: 'newcomer' }],
      ladder: [
        { account_id: OTHER, points: 40, weeks_scored: 3, position: '1', total: '2' },
        { account_id: ME, points: 25, weeks_scored: 2, position: '2', total: '2' }
      ]
    };
    const body = (await read()).json();

    expect(body.entries).toEqual([
      { rank: 1, points: 40, weeksScored: 3, isSelf: false },
      { rank: 2, points: 25, weeksScored: 2, isSelf: true }
    ]);
    // The one identity a reader can attach a person to is their own. Nothing in
    // the payload carries anybody else's account, name, or handle.
    expect(JSON.stringify(body)).not.toContain(OTHER);
    expect(JSON.stringify(body)).not.toContain(ME);
  });

  it('says in the response why there are no names', async () => {
    stubs = { enrollment: [{ division: 'newcomer' }] };
    const body = (await read()).json();

    expect(body.ladderNote).toContain('without names');
    expect(body.captureNote).toContain('no cell is claimed');
  });

  it("asks for the reader's own row alongside the page", async () => {
    stubs = { enrollment: [{ division: 'newcomer' }] };
    await read();

    // A ladder that cannot show somebody their own position when they rank
    // below the page is not answering the question they came with.
    const ranked = calls.find((call) => call.sql.includes('WITH ranked AS'));
    expect(ranked?.sql).toContain('OR account_id = $4');
    expect(ranked?.values).toContain(ME);
  });

  it('shares a rank between equal point totals', async () => {
    stubs = { enrollment: [{ division: 'newcomer' }] };
    await read();

    // `rank()` and not `row_number()`: equal points share a rank, the same rule
    // the stored season standings use.
    expect(sql()).toContain('rank() OVER (ORDER BY points DESC)');
    expect(sql()).not.toContain('row_number()');
  });
});

describe('GET /v1/staff/territory/seasons/:seasonId/concentration', () => {
  const read = () =>
    app.inject({
      method: 'GET',
      url: `/v1/staff/territory/seasons/${SEASON}/concentration`,
      headers: auth
    });

  const observation = (overrides: Record<string, unknown> = {}) => ({
    division: 'newcomer',
    observed_on: '2026-09-14',
    participants: 120,
    top_decile_share: '0.41000',
    top_participant_share: '0.09000',
    applicable: true,
    breached: true,
    breach_run_days: 3,
    ...overrides
  });

  it('needs a season operator role', async () => {
    stubs = { roles: [] };

    expect((await read()).statusCode).toBe(403);
  });

  it('reports shares and never the participants behind them', async () => {
    asOperator({ concentration: [observation()] });
    const body = (await read()).json();

    expect(body.data[0]).toEqual({
      division: 'newcomer',
      observedOn: '2026-09-14',
      participants: 120,
      topDecileShare: 0.41,
      topParticipantShare: 0.09,
      applicable: true,
      breached: true,
      breachRunDays: 3,
      pausesAwards: false
    });
  });

  it('flags a seven-day run as pausing awards analysis', async () => {
    asOperator({ concentration: [observation({ breach_run_days: 7 })] });

    expect((await read()).json().data[0].pausesAwards).toBe(true);
  });

  it('does not act on a breach, only reports it', async () => {
    asOperator({
      concentration: [
        observation({
          top_decile_share: '0.90000',
          top_participant_share: '0.50000',
          breach_run_days: 30
        })
      ]
    });
    await read();

    // Pausing awards and investigating scarcity are judgements people make.
    // Nothing here writes, freezes, or rescinds anything.
    expect(sql()).not.toContain('UPDATE');
    expect(sql()).not.toContain('INSERT');
  });
});

describe('GET /v1/staff/territory/seasons/:seasonId/weeks', () => {
  it('marks a week showing an older version as rolled back', async () => {
    asOperator({
      weeks: [
        {
          week_starts_on: WEEK,
          current_version: 1,
          latest_version: 2,
          finalized_at: new Date('2026-09-14T01:00:00.000Z')
        }
      ]
    });
    const response = await app.inject({
      method: 'GET',
      url: `/v1/staff/territory/seasons/${SEASON}/weeks`,
      headers: auth
    });

    expect(response.json().data[0]).toMatchObject({
      weekStartsOn: WEEK,
      currentVersion: 1,
      latestVersion: 2,
      rolledBack: true
    });
  });
});

describe('POST /v1/staff/territory/seasons/:seasonId/weeks/:weekStartsOn/rollback', () => {
  const rollback = (body: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: `/v1/staff/territory/seasons/${SEASON}/weeks/${WEEK}/rollback`,
      headers: auth,
      payload: body
    });

  const finalized = (currentVersion = 3, extra: Stubs = {}) =>
    asOperator({
      weekState: [
        { current_version: currentVersion, finalized_at: new Date('2026-09-14T01:00:00.000Z') }
      ],
      ...extra
    });

  it('needs a season operator role', async () => {
    stubs = { roles: [] };

    expect((await rollback({ toVersion: 1, reason: 'Scoring defect' })).statusCode).toBe(403);
  });

  it('is 404 for a week nobody has finalized', async () => {
    asOperator({ weekState: [] });

    expect((await rollback({ toVersion: 1, reason: 'Scoring defect' })).statusCode).toBe(404);
  });

  it('refuses to roll forward', async () => {
    finalized(2);

    // A newer snapshot comes from recomputing, which is a different act with a
    // different record. One verb doing both would make corrections and
    // reversals read the same in the audit trail.
    expect((await rollback({ toVersion: 5, reason: 'Trying to skip ahead' })).statusCode).toBe(422);
  });

  it('refuses the version already in use', async () => {
    finalized(3);

    expect((await rollback({ toVersion: 3, reason: 'No-op' })).statusCode).toBe(422);
  });

  it('refuses a version nobody computed', async () => {
    finalized(3, { snapshotCount: '0' });
    const response = await rollback({ toVersion: 2, reason: 'Pointing at nothing' });

    expect(response.statusCode).toBe(422);
    expect(response.json().message).toContain('does not exist');
  });

  it('requires a written reason', async () => {
    finalized(3);

    // A participant whose week changed is owed an explanation in somebody's
    // words, not a status code.
    expect((await rollback({ toVersion: 1, reason: '' })).statusCode).toBe(400);
  });

  it('moves the pointer, records why, and edits no snapshot', async () => {
    finalized(3);
    const response = await rollback({ toVersion: 1, reason: 'Eligibility dataset was wrong' });

    expect(response.statusCode).toBe(200);
    expect(response.json().data[0]).toMatchObject({ currentVersion: 1, rolledBack: true });
    expect(sql()).toContain('INSERT INTO territory_week_rollbacks');
    expect(sql()).toContain('UPDATE territory_week_state SET current_version');
    expect(sql()).toContain("'territory.week_rolled_back'");
    // Nothing is edited or deleted: the week points at a snapshot that already
    // exists, and every version stays exactly as it was computed.
    expect(sql()).not.toContain('UPDATE territory_cell_control');
    expect(sql()).not.toContain('DELETE FROM territory_cell_control');
    expect(sql()).not.toContain('DELETE FROM territory_ladder_weeks');
  });

  it('stores the reason the operator wrote', async () => {
    finalized(3);
    await rollback({ toVersion: 1, reason: '  Eligibility dataset was wrong  ' });

    const insert = calls.find((call) => call.sql.includes('INSERT INTO territory_week_rollbacks'));
    expect(insert?.values).toContain('Eligibility dataset was wrong');
  });
});
