import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Database } from '@runsphere/db';
import { buildApp } from './app.js';
import { createAccessToken } from './auth.js';

const SECRET = 'friend-standings-test-secret';
const ME = '00000000-0000-4000-8000-00000000000a';
const RAVI = '00000000-0000-4000-8000-00000000000b';
const ANA = '00000000-0000-4000-8000-00000000000c';

const progressionRule = {
  xpPerActiveMinute: 1,
  xpPerActiveDay: 20,
  dailyCapMinutes: 240,
  minMinutesPerActiveDay: 1,
  goalActiveDays: 3,
  levels: [0, 100, 250]
};

const member = (accountId: string, displayName: string | null) => ({
  account_id: accountId,
  display_name: displayName,
  cosmetic: displayName ? { avatarKey: 'loop-1' } : null,
  activity_visibility: 'private'
});

const activity = (accountId: string, minutes: number, processedAt: string) => ({
  account_id: accountId,
  active_duration_seconds: minutes * 60,
  processed_at: new Date(processedAt)
});

interface Stubs {
  rule?: Record<string, unknown>[];
  members?: Record<string, unknown>[];
  activities?: Record<string, unknown>[];
}

const fakeDatabase = (stubs: Stubs = {}) => {
  const calls: { sql: string; values: readonly unknown[] | undefined }[] = [];
  const respond = (sql: string) => {
    if (sql.includes("kind = 'progression'"))
      return { rows: stubs.rule ?? [{ version: 4, definition: progressionRule }] };
    if (sql.includes('WITH mutual AS')) return { rows: stubs.members ?? [] };
    if (sql.includes('FROM activity_submissions')) return { rows: stubs.activities ?? [] };
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
    database(): Database {
      return this as unknown as Database;
    }
  };
};

/**
 * One app for the file, with the database swapped per call.
 *
 * Building a Fastify app registers every route in the product and costs a
 * meaningful fraction of a second; fourteen of them put individual tests within
 * reach of the default five-second timeout on a loaded machine. The app holds a
 * reference to a stable proxy, so a test can still hand it a fresh fake.
 */
let active: ReturnType<typeof fakeDatabase> = fakeDatabase();
const database = {
  query: (sql: string, values?: readonly unknown[]) => active.query(sql, values),
  connect: () => active.connect(),
  end: async () => undefined
} as unknown as Database;
const app = buildApp({ db: database, authSecret: SECRET });
beforeAll(async () => {
  await app.ready();
}, 120_000);
afterAll(async () => {
  await app.close();
});

const appWith = (db: ReturnType<typeof fakeDatabase>) => {
  active = db;
  return app;
};

const auth = { authorization: `Bearer ${createAccessToken(ME, SECRET)}` };
const standings = (db: ReturnType<typeof fakeDatabase>) =>
  appWith(db).inject({ method: 'GET', url: '/v1/friends/standings', headers: auth });

describe('GET /v1/friends/standings', () => {
  it('ranks mutual friends by capped weekly active minutes', async () => {
    // The current Kolkata week is whatever week the test runs in, so activity
    // instants are derived from the period the route reports.
    const db = fakeDatabase({
      members: [member(ME, 'Maya'), member(RAVI, 'Ravi'), member(ANA, 'Ana')]
    });
    const first = await standings(db);
    const weekStart = (
      db.calls.find((call) => call.sql.includes('FROM activity_submissions'))?.values?.[1] as Date
    ).toISOString();

    const scored = fakeDatabase({
      members: [member(ME, 'Maya'), member(RAVI, 'Ravi'), member(ANA, 'Ana')],
      activities: [
        activity(RAVI, 200, weekStart),
        activity(ME, 90, weekStart),
        activity(ME, 30, weekStart)
      ]
    });
    const response = await standings(scored);

    expect(first.statusCode).toBe(200);
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.ruleVersion).toBe('4');
    expect(body.entries).toEqual([
      {
        profile: expect.objectContaining({ id: RAVI, displayName: 'Ravi' }),
        rank: 1,
        cappedActiveMinutes: 200,
        isSelf: false
      },
      {
        profile: expect.objectContaining({ id: ME, displayName: 'Maya' }),
        rank: 2,
        cappedActiveMinutes: 120,
        isSelf: true
      },
      {
        profile: expect.objectContaining({ id: ANA, displayName: 'Ana' }),
        rank: 3,
        cappedActiveMinutes: 0,
        isSelf: false
      }
    ]);
  });

  it('shares a rank for equal scores instead of breaking the tie', async () => {
    const probe = fakeDatabase({ members: [member(ME, 'Maya')] });
    await standings(probe);
    const weekStart = (
      probe.calls.find((call) => call.sql.includes('FROM activity_submissions'))
        ?.values?.[1] as Date
    ).toISOString();

    const response = await standings(
      fakeDatabase({
        members: [member(ME, 'Maya'), member(RAVI, 'Ravi'), member(ANA, 'Ana')],
        activities: [activity(ME, 60, weekStart), activity(RAVI, 60, weekStart)]
      })
    );

    expect(response.json().entries.map((entry: { rank: number }) => entry.rank)).toEqual([1, 1, 3]);
  });

  it('applies the published per-day cap rather than a raw weekly sum', async () => {
    const probe = fakeDatabase({ members: [member(ME, 'Maya')] });
    await standings(probe);
    const weekStart = (
      probe.calls.find((call) => call.sql.includes('FROM activity_submissions'))
        ?.values?.[1] as Date
    ).toISOString();

    const response = await standings(
      fakeDatabase({
        rule: [{ version: 4, definition: { ...progressionRule, dailyCapMinutes: 60 } }],
        members: [member(ME, 'Maya')],
        activities: [activity(ME, 200, weekStart)]
      })
    );

    expect(response.json().entries[0].cappedActiveMinutes).toBe(60);
  });

  it('asks nobody whether they joined, because friendship is the only gate', async () => {
    // Product decision 2026-09-06 (`gameplay.md`): "there is no separate 'join
    // board' toggle". The read used to probe `leaderboard_opt_ins` first and
    // return an empty board to anybody who had not joined; both are gone.
    const db = fakeDatabase({ members: [member(ME, 'Maya')] });
    await standings(db);

    expect(db.calls.some((call) => call.sql.includes('leaderboard_opt_ins'))).toBe(false);
    expect(db.calls.some((call) => call.sql.includes('WITH mutual AS'))).toBe(true);
  });

  it('shows a mutual friend without either side opting in', async () => {
    const db = fakeDatabase({ members: [member(ME, 'Maya'), member(RAVI, 'Ravi')] });
    const response = await standings(db);

    expect(response.json().entries).toHaveLength(2);
    expect(response.json().participating).toBeUndefined();
  });

  it('returns an empty board when no progression rule publishes the cap', async () => {
    const response = await standings(fakeDatabase({ rule: [], members: [member(ME, 'Maya')] }));
    expect(response.json()).toMatchObject({ entries: [] });
    expect(response.json().ruleVersion).toBeUndefined();
  });

  it('requires mutual friendship and no block on either side', async () => {
    const db = fakeDatabase({ members: [member(ME, 'Maya')] });
    await standings(db);
    const sql = db.calls.find((call) => call.sql.includes('WITH mutual AS'))?.sql ?? '';
    expect(sql).toContain('back.friend_account_id = $1');
    expect(sql).toContain('blocks block');
    expect(sql).toContain('account.deleted_at IS NULL');
  });

  it('still keeps a suspended account off the board', async () => {
    // The one exclusion the opt-in removal must not take with it: a sharing
    // suspension pauses being visible to other people, and a name on a board
    // is exactly that.
    const db = fakeDatabase({ members: [member(ME, 'Maya')] });
    await standings(db);
    const sql = db.calls.find((call) => call.sql.includes('WITH mutual AS'))?.sql ?? '';

    expect(sql).toContain('NOT EXISTS (SELECT 1 FROM sanctions');
  });

  it('never selects or returns location, route, pace, distance, or timestamps', async () => {
    const probe = fakeDatabase({ members: [member(ME, 'Maya')] });
    await standings(probe);
    const weekStart = (
      probe.calls.find((call) => call.sql.includes('FROM activity_submissions'))
        ?.values?.[1] as Date
    ).toISOString();
    const db = fakeDatabase({
      members: [member(ME, 'Maya'), member(RAVI, 'Ravi')],
      activities: [activity(ME, 45, weekStart)]
    });
    const response = await standings(db);

    const activitySql =
      db.calls.find((call) => call.sql.includes('FROM activity_submissions'))?.sql ?? '';
    expect(activitySql).not.toMatch(/distance|geometry|latitude|longitude|pace|speed|route/i);
    expect(JSON.stringify(response.json())).not.toMatch(
      /email|latitude|longitude|pace|speed|distance|processedAt/i
    );
  });

  it('names a member without a profile neutrally instead of by account id', async () => {
    const response = await standings(fakeDatabase({ members: [member(RAVI, null)] }));
    expect(response.json().entries[0].profile).toMatchObject({
      displayName: 'RunSphere member',
      cosmetic: { avatarKey: 'default' }
    });
  });
});
