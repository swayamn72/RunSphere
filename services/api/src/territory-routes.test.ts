import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '@runsphere/db';
import { buildApp } from './app.js';
import { createAccessToken } from './auth.js';

const SECRET = 'territory-routes-test-secret';
const ME = '00000000-0000-4000-8000-00000000000a';
const SEASON = '00000000-0000-4000-8000-0000000000b1';

const seasonRow = (overrides: Record<string, unknown> = {}) => ({
  id: SEASON,
  title: 'Spring season',
  status: 'open',
  starts_at: new Date('2026-10-01T00:00:00.000Z'),
  ends_at: new Date('2026-11-12T00:00:00.000Z'),
  privacy_policy_version: '2026-09',
  participant_count: '12',
  division: null,
  prior_active_weeks: null,
  enrolled_at: null,
  ...overrides
});

interface Stubs {
  roles?: { role: string }[];
  /** The member-facing season lookup; `[]` means no season. */
  season?: Record<string, unknown>[];
  /** The `SELECT id, status` lookup used before enrolling. */
  seasonStatus?: Record<string, unknown>[];
  rule?: Record<string, unknown>[];
  priorWeeks?: string;
  changed?: Record<string, unknown>[];
  divisions?: Record<string, unknown>[];
  seasonExists?: boolean;
}

const fakeDatabase = (stubs: Stubs = {}) => {
  const calls: { sql: string; values: readonly unknown[] | undefined }[] = [];
  const respond = (sql: string) => {
    if (sql.includes('FROM staff_role_assignments')) return { rows: stubs.roles ?? [] };
    if (sql.includes("kind = 'territory'"))
      return {
        rows: stubs.rule ?? [
          {
            version: 1,
            definition: {
              divisions: [
                { key: 'newcomer', maxPriorActiveWeeks: 3 },
                { key: 'returning', maxPriorActiveWeeks: 25 },
                { key: 'established' }
              ]
            }
          }
        ]
      };
    if (sql.includes('count(DISTINCT date_trunc'))
      return { rows: [{ weeks: stubs.priorWeeks ?? '1' }] };
    if (sql.includes('FROM territory_seasons season')) return { rows: stubs.season ?? [] };
    if (sql.includes('INSERT INTO territory_seasons') || sql.includes('UPDATE territory_seasons'))
      return { rows: stubs.changed ?? [seasonRow({ status: 'announced' })] };
    if (sql.includes('SELECT id, status FROM territory_seasons'))
      return { rows: stubs.seasonStatus ?? [{ id: SEASON, status: 'open' }] };
    if (sql.includes('SELECT id FROM territory_seasons'))
      return { rows: stubs.seasonExists === false ? [] : [{ id: SEASON }] };
    if (sql.includes('FROM territory_enrollments\n         WHERE season_id'))
      return { rows: stubs.divisions ?? [] };
    if (sql.includes('GROUP BY division')) return { rows: stubs.divisions ?? [] };
    return { rows: [] };
  };
  const query = vi.fn(async (sql: string, values?: readonly unknown[]) => {
    calls.push({ sql, values });
    return respond(sql);
  });
  const client = { query, release: vi.fn() };
  return {
    query,
    calls,
    connect: vi.fn(async () => client),
    end: vi.fn(async () => undefined),
    sql: () => calls.map((call) => call.sql).join('\n'),
    database(): Database {
      return this as unknown as Database;
    }
  };
};

const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

const appWith = (db: ReturnType<typeof fakeDatabase>) => {
  const app = buildApp({ db: db.database(), authSecret: SECRET });
  apps.push(app);
  return app;
};

const auth = { authorization: `Bearer ${createAccessToken(ME, SECRET)}` };
const operator = (stubs: Stubs = {}) =>
  fakeDatabase({ roles: [{ role: 'season_operator' }], ...stubs });

describe('GET /v1/territory/season', () => {
  const read = (db: ReturnType<typeof fakeDatabase>) =>
    appWith(db).inject({ method: 'GET', url: '/v1/territory/season', headers: auth });

  it('says capture is off even when no season exists', async () => {
    const db = fakeDatabase({ season: [] });
    const response = await read(db);

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.season).toBeUndefined();
    // True whether or not a season exists, so it is said either way.
    expect(body.captureNote).toContain('no cell is claimed');
  });

  it('shows a joinable season with a count, never a list of who joined', async () => {
    const db = fakeDatabase({ season: [seasonRow()] });
    const body = (await read(db)).json();

    expect(body.season).toMatchObject({
      title: 'Spring season',
      joinable: true,
      captureEnabled: false,
      participantCount: 12
    });
    expect(body.season.enrollment).toBeUndefined();
  });

  it('shows the reader their own division and the band it came from', async () => {
    const db = fakeDatabase({
      season: [
        seasonRow({
          division: 'returning',
          prior_active_weeks: 9,
          enrolled_at: new Date('2026-09-20T10:00:00.000Z')
        })
      ]
    });

    // The band is returned so an assignment can be explained to the person it
    // was made about, rather than being a label they cannot question.
    expect((await read(db)).json().season.enrollment).toMatchObject({
      division: 'returning',
      priorActiveWeeks: 9
    });
  });

  it('never reads a location, a cell, or an activity detail', async () => {
    const db = fakeDatabase({ season: [seasonRow()] });
    await read(db);

    const sql = db.sql();
    for (const forbidden of ['cell', 'h3', 'latitude', 'longitude', 'route', 'geom'])
      expect(sql.toLowerCase()).not.toContain(forbidden);
  });

  it('never surfaces an ended season as something to join', async () => {
    const db = fakeDatabase({ season: [] });
    await read(db);

    expect(
      db.calls.find((call) => call.sql.includes('FROM territory_seasons season'))?.sql
    ).toContain("season.status <> 'ended'");
  });
});

describe('PUT /v1/territory/seasons/:seasonId/enrollment', () => {
  const enroll = (db: ReturnType<typeof fakeDatabase>, enrolled: boolean) =>
    appWith(db).inject({
      method: 'PUT',
      url: `/v1/territory/seasons/${SEASON}/enrollment`,
      headers: auth,
      payload: { enrolled }
    });

  it('assigns a division from weeks of history alone', async () => {
    const db = fakeDatabase({ priorWeeks: '9', season: [seasonRow()] });
    await enroll(db, true);

    const insert = db.calls.find((call) => call.sql.includes('INSERT INTO territory_enrollments'))!;
    expect(insert.values?.[2]).toBe('returning');
    expect(insert.values?.[3]).toBe(9);
  });

  it('puts a first-time participant in the newcomer band', async () => {
    const db = fakeDatabase({ priorWeeks: '0', season: [seasonRow()] });
    await enroll(db, true);

    const insert = db.calls.find((call) => call.sql.includes('INSERT INTO territory_enrollments'))!;
    expect(insert.values?.[2]).toBe('newcomer');
  });

  it('keeps the division already assigned when somebody re-joins', async () => {
    const db = fakeDatabase({ season: [seasonRow()] });
    await enroll(db, true);

    const insert = db.calls.find((call) => call.sql.includes('INSERT INTO territory_enrollments'))!;
    // Leaving is not a way to reroll a division, and rebalancing is a
    // between-seasons act.
    expect(insert.sql).toContain('DO UPDATE SET withdrawn_at = NULL');
    expect(insert.sql).not.toContain('division = EXCLUDED.division');
  });

  it('records a withdrawal rather than deleting the enrollment', async () => {
    const db = fakeDatabase({ season: [seasonRow()] });
    await enroll(db, false);

    expect(db.sql()).toContain('UPDATE territory_enrollments SET withdrawn_at = now()');
    expect(db.sql()).not.toContain('DELETE FROM territory_enrollments');
  });

  it('lets somebody leave without consulting the division rule at all', async () => {
    const db = fakeDatabase({ season: [seasonRow()] });
    await enroll(db, false);

    expect(db.sql()).not.toContain("kind = 'territory'");
  });

  it('refuses enrolment in a season that is only announced', async () => {
    const db = fakeDatabase({ seasonStatus: [{ id: SEASON, status: 'announced' }] });
    const response = await enroll(db, true);

    expect(response.statusCode).toBe(409);
    expect(db.sql()).not.toContain('INSERT INTO territory_enrollments');
  });

  it('refuses to invent a division when no rule is published', async () => {
    const db = fakeDatabase({ rule: [] });
    const response = await enroll(db, true);

    expect(response.statusCode).toBe(422);
    expect(db.sql()).not.toContain('INSERT INTO territory_enrollments');
  });

  it('answers 404 for a season that does not exist', async () => {
    const db = fakeDatabase({ seasonStatus: [] });

    expect((await enroll(db, true)).statusCode).toBe(404);
  });
});

describe('POST /v1/staff/territory/seasons', () => {
  const create = (db: ReturnType<typeof fakeDatabase>) =>
    appWith(db).inject({
      method: 'POST',
      url: '/v1/staff/territory/seasons',
      headers: auth,
      payload: {
        title: 'Spring season',
        startsAt: '2026-10-01T00:00:00.000Z',
        endsAt: '2026-11-12T00:00:00.000Z',
        h3Resolution: 9,
        privacyPolicyVersion: '2026-09'
      }
    });

  it('announces a season without opening it', async () => {
    const db = operator();
    const response = await create(db);

    expect(response.statusCode).toBe(201);
    // Describing a season and opening it are separate acts.
    expect(response.json().season.status).toBe('announced');
    expect(response.json().season.joinable).toBe(false);
  });

  it('pins the rule version with the season', async () => {
    const db = operator();
    await create(db);

    const insert = db.calls.find((call) => call.sql.includes('INSERT INTO territory_seasons'))!;
    expect(insert.values?.[4]).toBe(1);
  });

  it('refuses without a published rule, and without an operator role', async () => {
    expect((await create(operator({ rule: [] }))).statusCode).toBe(422);
    expect((await create(fakeDatabase({ roles: [{ role: 'moderator' }] }))).statusCode).toBe(403);
  });
});

describe('POST /v1/staff/territory/seasons/:seasonId/status', () => {
  const change = (db: ReturnType<typeof fakeDatabase>, status: 'open' | 'ended') =>
    appWith(db).inject({
      method: 'POST',
      url: `/v1/staff/territory/seasons/${SEASON}/status`,
      headers: auth,
      payload: { status }
    });

  it('opens enrolment on an announced season', async () => {
    const db = operator({ changed: [seasonRow({ status: 'open' })] });
    const response = await change(db, 'open');

    expect(response.statusCode).toBe(200);
    const update = db.calls.find((call) => call.sql.includes('UPDATE territory_seasons'))!;
    expect(update.sql).toContain("status = 'announced'");
  });

  it('offers no way to reach live, because the engine does not exist', async () => {
    const db = operator();
    const response = await appWith(db).inject({
      method: 'POST',
      url: `/v1/staff/territory/seasons/${SEASON}/status`,
      headers: auth,
      payload: { status: 'live' }
    });

    // `live` would say the engine is running; the contract does not admit it.
    expect(response.statusCode).toBe(400);
  });

  it('answers 409 when the season is not in a state for that change', async () => {
    const db = operator({ changed: [] });

    expect((await change(db, 'open')).statusCode).toBe(409);
  });
});

describe('GET /v1/staff/territory/seasons/:seasonId/divisions', () => {
  it('advises on sizes without moving anybody', async () => {
    const db = operator({
      divisions: [
        { division: 'newcomer', enrolled_count: '12' },
        { division: 'returning', enrolled_count: '150' },
        { division: 'established', enrolled_count: '400' }
      ]
    });
    const response = await appWith(db).inject({
      method: 'GET',
      url: `/v1/staff/territory/seasons/${SEASON}/divisions`,
      headers: auth
    });

    expect(response.json().data.map((size: { advice: string }) => size.advice)).toEqual([
      'merge',
      'healthy',
      'split'
    ]);
    // Advice for the next season start, never an action taken now.
    expect(db.sql()).not.toContain('UPDATE territory_enrollments');
  });
});
