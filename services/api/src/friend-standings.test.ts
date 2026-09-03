import { afterEach, describe, expect, it, vi } from 'vitest';
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
  participating?: boolean;
  rule?: Record<string, unknown>[];
  members?: Record<string, unknown>[];
  activities?: Record<string, unknown>[];
}

const fakeDatabase = (stubs: Stubs = {}) => {
  const calls: { sql: string; values: readonly unknown[] | undefined }[] = [];
  const respond = (sql: string) => {
    if (sql.includes('AS participating'))
      return { rows: [{ participating: stubs.participating ?? true }] };
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
const standings = (db: ReturnType<typeof fakeDatabase>) =>
  appWith(db).inject({ method: 'GET', url: '/v1/friends/standings', headers: auth });

describe('GET /v1/friends/standings', () => {
  it('ranks opted-in mutual friends by capped weekly active minutes', async () => {
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
    expect(body.participating).toBe(true);
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

  it('returns an empty board with participating false until the account joins', async () => {
    const db = fakeDatabase({ participating: false, members: [member(ME, 'Maya')] });
    const response = await standings(db);

    expect(response.json()).toMatchObject({ participating: false, entries: [] });
    // Not on the board means not reading anyone else's score.
    expect(db.calls.some((call) => call.sql.includes('WITH mutual AS'))).toBe(false);
    expect(db.calls.some((call) => call.sql.includes('FROM activity_submissions'))).toBe(false);
  });

  it('returns an empty board when no progression rule publishes the cap', async () => {
    const response = await standings(fakeDatabase({ rule: [], members: [member(ME, 'Maya')] }));
    expect(response.json()).toMatchObject({ participating: true, entries: [] });
    expect(response.json().ruleVersion).toBeUndefined();
  });

  it('requires mutual friendship, a live opt-in, and no block on either side', async () => {
    const db = fakeDatabase({ members: [member(ME, 'Maya')] });
    await standings(db);
    const sql = db.calls.find((call) => call.sql.includes('WITH mutual AS'))?.sql ?? '';
    expect(sql).toContain('back.friend_account_id = $1');
    expect(sql).toContain('blocks block');
    expect(sql).toContain("optin.scope = 'friends'");
    expect(sql).toContain('optin.revoked_at IS NULL');
    expect(sql).toContain('account.deleted_at IS NULL');
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

describe('PUT /v1/friends/standings/participation', () => {
  const participation = (db: ReturnType<typeof fakeDatabase>, participating: boolean) =>
    appWith(db).inject({
      method: 'PUT',
      url: '/v1/friends/standings/participation',
      headers: auth,
      payload: { participating }
    });

  it('joins by opening or reopening the friends opt-in row', async () => {
    const db = fakeDatabase();
    const response = await participation(db, true);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ participating: true });
    const write = db.calls.find((call) => call.sql.includes('INSERT INTO leaderboard_opt_ins'));
    expect(write?.sql).toContain('revoked_at = NULL');
    expect(write?.values).toEqual([ME]);
  });

  it('leaves by revoking rather than deleting, keeping the opt-in auditable', async () => {
    const db = fakeDatabase();
    const response = await participation(db, false);

    expect(response.json()).toEqual({ participating: false });
    const write = db.calls.find((call) => call.sql.includes('UPDATE leaderboard_opt_ins'));
    expect(write?.sql).toContain('SET revoked_at = now()');
    expect(db.calls.some((call) => call.sql.includes('DELETE FROM leaderboard_opt_ins'))).toBe(
      false
    );
    expect(db.calls.some((call) => call.sql.includes('privacy_audit_events'))).toBe(true);
  });

  // Fastify's ajv coerces scalars app-wide, so `1`/`0`/`null` become booleans
  // rather than failing validation. Only genuinely unusable bodies are listed.
  it.each([
    ['missing', {}],
    ['a non-boolean string', { participating: 'yes' }],
    ['an object', { participating: { on: true } }]
  ])('rejects %s participating', async (_label, payload) => {
    const response = await appWith(fakeDatabase()).inject({
      method: 'PUT',
      url: '/v1/friends/standings/participation',
      headers: auth,
      payload
    });
    expect(response.statusCode).toBe(400);
  });

  it('ignores an unknown scope key rather than acting on it', async () => {
    // Fastify's ajv strips unknown properties app-wide, so an extra key is
    // dropped instead of rejected. What matters is that it changes nothing:
    // only the 'friends' scope is ever written.
    const db = fakeDatabase();
    const response = await appWith(db).inject({
      method: 'PUT',
      url: '/v1/friends/standings/participation',
      headers: auth,
      payload: { participating: true, scope: 'global' }
    });

    expect(response.json()).toEqual({ participating: true });
    const write = db.calls.find((call) => call.sql.includes('INSERT INTO leaderboard_opt_ins'));
    expect(write?.sql).toContain("'friends'");
    expect(write?.sql).not.toContain('global');
  });
});
