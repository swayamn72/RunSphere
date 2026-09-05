import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '@runsphere/db';
import { buildApp } from './app.js';
import { createAccessToken } from './auth.js';

const SECRET = 'global-board-test-secret';
const ME = '00000000-0000-4000-8000-00000000000a';
const RAVI = '00000000-0000-4000-8000-00000000000b';
const ANA = '00000000-0000-4000-8000-00000000000c';

const pageRow = (accountId: string, rank: number, score: number, displayName: string | null) => ({
  account_id: accountId,
  display_name: displayName,
  cosmetic: displayName ? { avatarKey: 'loop-1' } : null,
  activity_visibility: 'private',
  rank,
  score
});

interface Stubs {
  participating?: boolean;
  /** The reader's own board row; `[]` means the worker has not ranked them. */
  mine?: Record<string, unknown>[];
  page?: Record<string, unknown>[];
}

const fakeDatabase = (stubs: Stubs = {}) => {
  const calls: { sql: string; values: readonly unknown[] | undefined }[] = [];
  const respond = (sql: string) => {
    if (sql.includes('AS participating'))
      return { rows: [{ participating: stubs.participating ?? true }] };
    if (sql.includes('entry.account_id = $2'))
      return {
        rows: stubs.mine ?? [{ division: 'rising', rank: 2, score: 120, rule_version: 1 }]
      };
    if (sql.includes('FROM global_board_entries entry')) return { rows: stubs.page ?? [] };
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
const board = (db: ReturnType<typeof fakeDatabase>) =>
  appWith(db).inject({ method: 'GET', url: '/v1/boards/global', headers: auth });

describe('GET /v1/boards/global', () => {
  it('shows nothing to an account that has not opted in', async () => {
    const db = fakeDatabase({ participating: false });
    const response = await board(db);

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({ participating: false, entries: [] });
    expect(body.me).toBeUndefined();
    expect(body.division).toBeUndefined();
    // Reading other people's scores requires being on the board yourself.
    expect(db.sql()).not.toContain('FROM global_board_entries entry');
  });

  it('reports an honest empty board before the worker has ranked the reader', async () => {
    const db = fakeDatabase({ mine: [] });
    const response = await board(db);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ participating: true, entries: [] });
    expect(response.json().me).toBeUndefined();
  });

  it('returns the page of the reader own division with their own row', async () => {
    const db = fakeDatabase({
      page: [pageRow(RAVI, 1, 200, 'Ravi'), pageRow(ME, 2, 120, 'Maya'), pageRow(ANA, 3, 30, 'Ana')]
    });
    const response = await board(db);

    const body = response.json();
    expect(body.division).toBe('rising');
    expect(body.ruleVersion).toBe(1);
    // The reader's own standing is a rank and a score: they already know who
    // they are, so no second copy of their identity rides along.
    expect(body.me).toEqual({ rank: 2, cappedActiveMinutes: 120 });
    expect(body.entries.map((entry: { rank: number }) => entry.rank)).toEqual([1, 2, 3]);
    expect(body.entries[1].isSelf).toBe(true);
    // The page is one division of one week, taken from the stored board.
    const page = db.calls.find(
      (call) => call.sql.includes('FROM global_board_entries entry') && call.sql.includes('LIMIT')
    )!;
    expect(page.values?.[1]).toBe('rising');
  });

  it('hides a blocked account in either direction without renumbering ranks', async () => {
    const db = fakeDatabase({ page: [pageRow(RAVI, 1, 200, 'Ravi'), pageRow(ME, 3, 120, 'Maya')] });
    const response = await board(db);

    // The rank an account holds is a fact about the period, not about who is
    // looking, so a hidden entry leaves a gap rather than shifting the rest.
    expect(response.json().entries.map((entry: { rank: number }) => entry.rank)).toEqual([1, 3]);
    const page = db.calls.find((call) => call.sql.includes('FROM blocks block'))!;
    expect(page.sql).toContain('block.revoked_at IS NULL');
  });

  it('never reads route, location, pace, or distance', async () => {
    const db = fakeDatabase({ page: [pageRow(ME, 1, 120, 'Maya')] });
    await board(db);

    const sql = db.sql();
    for (const forbidden of ['route', 'geom', 'latitude', 'longitude', 'distance_meters'])
      expect(sql).not.toContain(forbidden);
    // The read never touches activity at all: the board is materialized.
    expect(sql).not.toContain('activity_submissions');
  });

  it('answers 401 to an unverifiable token before reading anything', async () => {
    const db = fakeDatabase();
    const response = await appWith(db).inject({
      method: 'GET',
      url: '/v1/boards/global',
      headers: { authorization: 'Bearer not-a-real-token' }
    });

    expect(response.statusCode).toBe(401);
    expect(db.sql()).toBe('');
  });
});

describe('PUT /v1/boards/global/participation', () => {
  const participation = (db: ReturnType<typeof fakeDatabase>, participating: boolean) =>
    appWith(db).inject({
      method: 'PUT',
      url: '/v1/boards/global/participation',
      headers: auth,
      payload: { participating }
    });

  it('opens the global scope and reopens a revoked one', async () => {
    const db = fakeDatabase();
    const response = await participation(db, true);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ participating: true });
    const insert = db.calls.find((call) => call.sql.includes('INSERT INTO leaderboard_opt_ins'))!;
    expect(insert.sql).toContain("'global'");
    expect(insert.sql).toContain('DO UPDATE SET opted_in_at = now(), revoked_at = NULL');
    const audit = db.calls.find((call) => call.sql.includes('privacy_audit_events'))!;
    expect(audit.values?.[1]).toBe('global_board.joined');
  });

  it('takes the account off the published board immediately when it leaves', async () => {
    const db = fakeDatabase();
    const response = await participation(db, false);

    expect(response.statusCode).toBe(200);
    expect(db.sql()).toContain('UPDATE leaderboard_opt_ins SET revoked_at = now()');
    // An opt-out that stays visible until the next sweep is not an opt-out.
    const removal = db.calls.find((call) => call.sql.includes('DELETE FROM global_board_entries'))!;
    expect(removal.values?.[0]).toBe(ME);
    // The opt-in row itself is revoked rather than deleted, so the history stays.
    expect(db.sql()).not.toContain('DELETE FROM leaderboard_opt_ins');
  });

  it('never rewrites a week that has already closed', async () => {
    const db = fakeDatabase();
    await participation(db, false);

    const removal = db.calls.find((call) => call.sql.includes('DELETE FROM global_board_entries'))!;
    expect(removal.sql).toContain('period_start >= $2::date');
  });

  it('answers 401 to an unverifiable token without changing an opt-in', async () => {
    const db = fakeDatabase();
    const response = await appWith(db).inject({
      method: 'PUT',
      url: '/v1/boards/global/participation',
      headers: { authorization: 'Bearer not-a-real-token' },
      payload: { participating: true }
    });

    expect(response.statusCode).toBe(401);
    expect(db.sql()).not.toContain('leaderboard_opt_ins');
  });
});
