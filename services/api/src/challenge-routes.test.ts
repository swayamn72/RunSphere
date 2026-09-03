import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '@runsphere/db';
import { buildApp } from './app.js';
import { createAccessToken } from './auth.js';

const SECRET = 'challenge-route-test-secret';
const ME = '00000000-0000-4000-8000-00000000000a';
const FRIEND = '00000000-0000-4000-8000-00000000000b';
const CHALLENGE = '00000000-0000-4000-8000-0000000000c1';

const ruleDefinition = {
  dailyCapMinutes: 240,
  minMinutesPerActiveDay: 1,
  lengthDays: [3, 7],
  modes: ['active_minutes', 'active_days']
};

const challengeRow = (overrides: Record<string, unknown> = {}) => ({
  id: CHALLENGE,
  mode: 'active_minutes',
  length_days: 3,
  status: 'invited',
  role: 'challenger',
  period_start: new Date('2026-08-31T00:00:00Z'),
  period_end: new Date('2026-09-03T00:00:00Z'),
  rule_version: '1',
  created_at: new Date('2026-08-31T04:00:00Z'),
  opponent_id: FRIEND,
  opponent_display_name: 'Ravi',
  opponent_cosmetic: { avatarKey: 'loop-2', tier: 'Trailkeeper' },
  opponent_visibility: 'private',
  ...overrides
});

interface Stubs {
  rule?: Record<string, unknown>[];
  eligible?: Record<string, unknown>[];
  created?: Record<string, unknown>[];
  challengeList?: Record<string, unknown>[];
  resultChallenge?: Record<string, unknown>[];
  storedResult?: Record<string, unknown>[];
  participants?: Record<string, unknown>[];
  locked?: Record<string, unknown>[];
}

/** Routes SQL by fragment so each test declares only the rows it cares about. */
const fakeDatabase = (stubs: Stubs = {}) => {
  const calls: { sql: string; values: readonly unknown[] | undefined }[] = [];
  const respond = (sql: string) => {
    if (sql.includes("kind = 'challenge'"))
      return { rows: stubs.rule ?? [{ version: 1, definition: ruleDefinition }] };
    if (sql.includes('AS friends'))
      return { rows: stubs.eligible ?? [{ friends: true, blocked: false }] };
    if (sql.includes('INSERT INTO challenges'))
      return { rows: stubs.created ?? [{ id: CHALLENGE }] };
    if (sql.includes('FROM challenges challenge'))
      return { rows: stubs.challengeList ?? [challengeRow()] };
    if (sql.includes('SELECT id, mode, period_start')) return { rows: stubs.resultChallenge ?? [] };
    if (sql.includes('FROM challenge_results')) return { rows: stubs.storedResult ?? [] };
    if (sql.includes('FROM challenge_participant_results'))
      return { rows: stubs.participants ?? [] };
    if (sql.includes('FOR UPDATE')) return { rows: stubs.locked ?? [] };
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
const create = { friendAccountId: FRIEND, mode: 'active_minutes', lengthDays: 3 };

describe('POST /v1/challenges', () => {
  it('creates an invite to a mutual friend and notifies only the invitee', async () => {
    const db = fakeDatabase();
    const response = await appWith(db).inject({
      method: 'POST',
      url: '/v1/challenges',
      headers: auth,
      payload: create
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      id: CHALLENGE,
      mode: 'active_minutes',
      lengthDays: 3,
      status: 'invited',
      periodStart: '2026-08-31',
      periodEnd: '2026-09-03',
      role: 'challenger',
      opponent: { id: FRIEND, displayName: 'Ravi' }
    });
    const notice = db.calls.find((call) => call.sql.includes('INSERT INTO notification_inbox'));
    expect(notice?.values?.[0]).toBe(FRIEND);
    // A summary is the opponent's Profile only: no email, location, or pace.
    expect(JSON.stringify(response.json())).not.toMatch(/email|latitude|longitude|pace|speed/i);
  });

  it('refuses a mode the published rule cannot score instead of creating a 0-0 tie', async () => {
    const db = fakeDatabase();
    const response = await appWith(db).inject({
      method: 'POST',
      url: '/v1/challenges',
      headers: auth,
      payload: { ...create, mode: 'quest_completion' }
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().message).toMatch(/quest_completion.*not available yet/);
    expect(db.calls.some((call) => call.sql.includes('INSERT INTO challenges'))).toBe(false);
  });

  it('refuses a length the published rule does not offer', async () => {
    const response = await appWith(fakeDatabase()).inject({
      method: 'POST',
      url: '/v1/challenges',
      headers: auth,
      payload: { ...create, lengthDays: 7, mode: 'active_days' }
    });
    expect(response.statusCode).toBe(201);

    const rejected = await appWith(
      fakeDatabase({ rule: [{ version: 1, definition: { ...ruleDefinition, lengthDays: [7] } }] })
    ).inject({ method: 'POST', url: '/v1/challenges', headers: auth, payload: create });
    expect(rejected.statusCode).toBe(422);
    expect(rejected.json().message).toMatch(/3 days is not available/);
  });

  it('rejects a body the contract does not allow rather than coercing it', async () => {
    const app = appWith(fakeDatabase());
    for (const payload of [
      { ...create, lengthDays: 5 },
      { ...create, mode: 'distance' },
      { ...create, friendAccountId: 'not-a-uuid' },
      { friendAccountId: FRIEND, mode: 'active_minutes' }
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/challenges',
        headers: auth,
        payload
      });
      expect(response.statusCode).toBe(400);
    }
  });

  it('answers the same way for a stranger, a one-way follow, and a blocked friend', async () => {
    for (const eligible of [
      [],
      [{ friends: false, blocked: false }],
      [{ friends: true, blocked: true }]
    ]) {
      const response = await appWith(fakeDatabase({ eligible })).inject({
        method: 'POST',
        url: '/v1/challenges',
        headers: auth,
        payload: create
      });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ message: 'Friend not found' });
    }
  });

  it('reports a conflict rather than opening a second challenge with the same friend', async () => {
    const response = await appWith(fakeDatabase({ created: [] })).inject({
      method: 'POST',
      url: '/v1/challenges',
      headers: auth,
      payload: create
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().message).toMatch(/already open/);
  });

  it('reports unavailable when no challenge rule is published', async () => {
    const response = await appWith(fakeDatabase({ rule: [] })).inject({
      method: 'POST',
      url: '/v1/challenges',
      headers: auth,
      payload: create
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().message).toMatch(/Challenge rule unavailable/);
  });
});

describe('GET /v1/challenges', () => {
  it('lists challenges on either side with the other participant as the opponent', async () => {
    const db = fakeDatabase({
      challengeList: [challengeRow(), challengeRow({ id: CHALLENGE, status: 'finished' })]
    });
    const response = await appWith(db).inject({
      method: 'GET',
      url: '/v1/challenges',
      headers: auth
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toHaveLength(2);
    // The reader's side is projected so a client can tell an invite it must
    // answer from one it sent.
    expect(response.json().data[0].role).toBe('challenger');
    const listing = db.calls.find((call) => call.sql.includes('FROM challenges challenge'));
    expect(listing?.sql).toContain('challenge.challenger_account_id = $1');
    expect(listing?.sql).toContain('challenge.opponent_account_id = $1');
    expect(listing?.values).toEqual([ME]);
  });

  it('names an opponent without a profile neutrally instead of exposing an account id', async () => {
    const response = await appWith(
      fakeDatabase({
        challengeList: [challengeRow({ opponent_display_name: null, opponent_cosmetic: null })]
      })
    ).inject({ method: 'GET', url: '/v1/challenges', headers: auth });

    expect(response.json().data[0].opponent).toMatchObject({
      displayName: 'RunSphere member',
      cosmetic: { avatarKey: 'default' }
    });
  });

  it('requires a session', async () => {
    const app = appWith(fakeDatabase());
    // The shared authorization header schema rejects a missing header before
    // the handler runs; a present but unusable token is the 401.
    const missing = await app.inject({ method: 'GET', url: '/v1/challenges' });
    expect(missing.statusCode).toBe(400);
    const invalid = await app.inject({
      method: 'GET',
      url: '/v1/challenges',
      headers: { authorization: 'Bearer not-a-real-token' }
    });
    expect(invalid.statusCode).toBe(401);
    const otherSecret = await app.inject({
      method: 'GET',
      url: '/v1/challenges',
      headers: { authorization: `Bearer ${createAccessToken(ME, 'a-different-secret')}` }
    });
    expect(otherSecret.statusCode).toBe(401);
  });
});

describe('PATCH /v1/challenges/:challengeId', () => {
  it('accepts an open invite and restarts the window on the day of agreement', async () => {
    const db = fakeDatabase({
      locked: [{ id: CHALLENGE, challenger_account_id: FRIEND }],
      challengeList: [challengeRow({ status: 'active', role: 'opponent' })]
    });
    const response = await appWith(db).inject({
      method: 'PATCH',
      url: `/v1/challenges/${CHALLENGE}`,
      headers: auth,
      payload: { accept: true }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('active');
    const update = db.calls.find((call) => call.sql.includes("SET status = 'active'"));
    expect(update?.sql).toContain('period_end = $2::date + length_days');
    // Only the invited account may answer, and only while the invite is open.
    const lock = db.calls.find((call) => call.sql.includes('FOR UPDATE'));
    expect(lock?.sql).toContain('opponent_account_id = $2');
    expect(lock?.sql).toContain("status = 'invited'");
    expect(lock?.sql).toContain('invite_expires_at > now()');
    const notice = db.calls.find((call) => call.sql.includes('INSERT INTO notification_inbox'));
    expect(notice?.values?.[0]).toBe(FRIEND);
  });

  it('declines without starting a window', async () => {
    const db = fakeDatabase({
      locked: [{ id: CHALLENGE, challenger_account_id: FRIEND }],
      challengeList: [challengeRow({ status: 'declined' })]
    });
    const response = await appWith(db).inject({
      method: 'PATCH',
      url: `/v1/challenges/${CHALLENGE}`,
      headers: auth,
      payload: { accept: false }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('declined');
    expect(db.calls.some((call) => call.sql.includes("SET status = 'active'"))).toBe(false);
    expect(db.calls.some((call) => call.sql.includes("SET status = 'declined'"))).toBe(true);
  });

  it('reports a conflict for an invite that lapsed, was answered, or is not yours', async () => {
    const response = await appWith(fakeDatabase({ locked: [] })).inject({
      method: 'PATCH',
      url: `/v1/challenges/${CHALLENGE}`,
      headers: auth,
      payload: { accept: true }
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().message).toMatch(/no longer open/);
  });
});

describe('GET /v1/challenges/:challengeId/result', () => {
  const finished = [
    {
      id: CHALLENGE,
      mode: 'active_minutes',
      period_start: '2026-08-31',
      period_end: '2026-09-03',
      status: 'finished'
    }
  ];

  it('returns two pace-neutral scores and the winner', async () => {
    const response = await appWith(
      fakeDatabase({
        resultChallenge: finished,
        storedResult: [{ rule_version: '1', winner_account_id: ME }],
        participants: [
          { account_id: ME, score: 120 },
          { account_id: FRIEND, score: 45 }
        ]
      })
    ).inject({ method: 'GET', url: `/v1/challenges/${CHALLENGE}/result`, headers: auth });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      id: CHALLENGE,
      mode: 'active_minutes',
      periodStart: '2026-08-31',
      periodEnd: '2026-09-03',
      participants: [
        { accountId: ME, score: 120 },
        { accountId: FRIEND, score: 45 }
      ],
      winnerAccountId: ME,
      ruleVersion: '1'
    });
  });

  it('omits the winner for a recorded tie instead of naming one', async () => {
    const response = await appWith(
      fakeDatabase({
        resultChallenge: finished,
        storedResult: [{ rule_version: '1', winner_account_id: null }],
        participants: [
          { account_id: ME, score: 60 },
          { account_id: FRIEND, score: 60 }
        ]
      })
    ).inject({ method: 'GET', url: `/v1/challenges/${CHALLENGE}/result`, headers: auth });

    expect(response.statusCode).toBe(200);
    expect(response.json().winnerAccountId).toBeUndefined();
  });

  it('says the result is not ready rather than presenting a zeroed or half-written one', async () => {
    const unscored = await appWith(fakeDatabase({ resultChallenge: finished })).inject({
      method: 'GET',
      url: `/v1/challenges/${CHALLENGE}/result`,
      headers: auth
    });
    expect(unscored.statusCode).toBe(409);
    expect(unscored.json().message).toMatch(/not ready yet/);

    const halfWritten = await appWith(
      fakeDatabase({
        resultChallenge: finished,
        storedResult: [{ rule_version: '1', winner_account_id: null }],
        participants: [{ account_id: ME, score: 120 }]
      })
    ).inject({ method: 'GET', url: `/v1/challenges/${CHALLENGE}/result`, headers: auth });
    expect(halfWritten.statusCode).toBe(409);
  });

  it('does not confirm a challenge exists for someone who is not in it', async () => {
    const db = fakeDatabase({ resultChallenge: [] });
    const response = await appWith(db).inject({
      method: 'GET',
      url: `/v1/challenges/${CHALLENGE}/result`,
      headers: auth
    });
    expect(response.statusCode).toBe(404);
    const lookup = db.calls.find((call) => call.sql.includes('SELECT id, mode, period_start'));
    expect(lookup?.sql).toContain('challenger_account_id = $2 OR opponent_account_id = $2');
  });
});

describe('challenge OpenAPI surface', () => {
  it('publishes every challenge route now that the server implements them', async () => {
    const app = appWith(fakeDatabase());
    await app.ready();
    const document = app.swagger();
    expect(document.paths).toHaveProperty('/v1/challenges');
    expect(document.paths).toHaveProperty('/v1/challenges/{challengeId}');
    expect(document.paths).toHaveProperty('/v1/challenges/{challengeId}/result');
  });
});
