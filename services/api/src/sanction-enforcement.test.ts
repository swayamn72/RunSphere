import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '@runsphere/db';
import { buildApp } from './app.js';
import { createAccessToken } from './auth.js';

/**
 * Sanction enforcement (milestone 3.8).
 *
 * 3.7 recorded sanctions; this is the suite that says they now *do* something.
 * Each test drives a real route with one live sanction in the fake database
 * and asserts both halves of the rule: the act is refused with the statement
 * staff wrote, and the un-guarded direction — leaving, withdrawing, reading —
 * still works.
 */
const SECRET = 'sanction-enforcement-test-secret';
const ME = '00000000-0000-4000-8000-00000000000a';
const RAVI = '00000000-0000-4000-8000-00000000000b';
const CLUB = '00000000-0000-4000-8000-0000000000c1';
const CHALLENGE = '00000000-0000-4000-8000-0000000000d1';
const COMPETITION = '00000000-0000-4000-8000-0000000000f1';

const STATEMENT = 'Sharing is paused while we look at your display name.';

const suspension = (kind = 'social_suspension') => ({
  kind,
  statement: STATEMENT,
  expires_at: null,
  revoked_at: null
});

interface Stubs {
  /** Live sanctions on the caller. */
  sanctions?: Record<string, unknown>[];
  clubRole?: 'owner' | 'admin' | 'member';
}

const fakeDatabase = (stubs: Stubs = {}) => {
  const calls: { sql: string; values: readonly unknown[] | undefined }[] = [];
  const respond = (sql: string) => {
    if (sql.includes('SELECT kind, statement, expires_at, revoked_at FROM sanctions'))
      return { rows: stubs.sanctions ?? [] };
    if (sql.includes('SELECT membership.role FROM club_memberships'))
      return { rows: stubs.clubRole ? [{ role: stubs.clubRole }] : [] };
    if (sql.includes('FROM club_challenges WHERE id'))
      return {
        rows: [
          {
            id: CHALLENGE,
            club_id: CLUB,
            mode: 'active_minutes',
            length_days: 7,
            status: 'active',
            period_start: '2026-08-31',
            period_end: '2026-09-07',
            rule_version: 1,
            created_at: new Date('2026-08-31T04:00:00.000Z')
          }
        ]
      };
    if (sql.includes('FROM competitions WHERE id'))
      return {
        rows: [
          {
            id: COMPETITION,
            title: 'September steady week',
            mode: 'active_minutes',
            status: 'published',
            period_start: '2026-09-07',
            period_end: '2026-09-14',
            min_prior_active_weeks: 0,
            rewards: '',
            dispute_period_hours: 48,
            rule_version: 1,
            created_at: new Date('2026-09-01T04:00:00.000Z'),
            closed_at: null
          }
        ]
      };
    if (sql.includes('count(DISTINCT date_trunc')) return { rows: [{ weeks: '10' }] };
    // The reader is on the boards they are reading, so the queries that filter
    // suspended accounts are actually reached.
    if (sql.includes('AS participating')) return { rows: [{ participating: true }] };
    if (sql.includes("kind = 'progression'"))
      return {
        rows: [
          {
            version: 4,
            definition: {
              xpPerActiveMinute: 1,
              xpPerActiveDay: 20,
              dailyCapMinutes: 240,
              minMinutesPerActiveDay: 1,
              goalActiveDays: 3,
              levels: [0, 100, 250]
            }
          }
        ]
      };
    if (sql.includes('entry.account_id = $2'))
      return { rows: [{ division: 'rising', rank: 1, score: 120, rule_version: 1 }] };
    // The reader is in the contests they read, so the standings queries — the
    // ones that filter suspended participants — are actually reached.
    if (sql.includes('FROM competition_enrollments WHERE competition_id'))
      return { rows: [{ participant_count: '1', enrolled: true }] };
    if (sql.includes('FROM club_challenge_participants WHERE challenge_id'))
      return { rows: [{ participant_count: '1', joined: true }] };
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

describe('a paused account cannot publish itself', () => {
  const paused = () => fakeDatabase({ sanctions: [suspension()], clubRole: 'member' });

  it('refuses the global board, in the words of the decision', async () => {
    const db = paused();
    const response = await appWith(db).inject({
      method: 'PUT',
      url: '/v1/boards/global/participation',
      headers: auth,
      payload: { participating: true }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ message: STATEMENT });
    expect(db.sql()).not.toContain('INSERT INTO leaderboard_opt_ins');
  });

  it('refuses club boards', async () => {
    const db = paused();
    const response = await appWith(db).inject({
      method: 'PUT',
      url: '/v1/clubs/board/participation',
      headers: auth,
      payload: { participating: true }
    });

    expect(response.statusCode).toBe(403);
    expect(db.sql()).not.toContain('INSERT INTO leaderboard_opt_ins');
  });

  it('refuses the friend board', async () => {
    const db = paused();
    const response = await appWith(db).inject({
      method: 'PUT',
      url: '/v1/friends/standings/participation',
      headers: auth,
      payload: { participating: true }
    });

    expect(response.statusCode).toBe(403);
    expect(db.sql()).not.toContain('INSERT INTO leaderboard_opt_ins');
  });

  it('refuses a friend request before it looks at the address', async () => {
    const db = paused();
    const response = await appWith(db).inject({
      method: 'POST',
      url: '/v1/friends/requests',
      headers: auth,
      payload: { email: 'ravi@example.com' }
    });

    expect(response.statusCode).toBe(403);
    // The refusal is about the sender, so nothing is looked up about the
    // recipient at all.
    expect(db.sql()).not.toContain('FROM accounts target');
  });

  it('refuses starting a club', async () => {
    const db = paused();
    const response = await appWith(db).inject({
      method: 'POST',
      url: '/v1/clubs',
      headers: auth,
      payload: { name: 'Morning Movers' }
    });

    expect(response.statusCode).toBe(403);
    expect(db.sql()).not.toContain('INSERT INTO clubs');
  });

  it('refuses joining a club before the code is looked up', async () => {
    const db = paused();
    const response = await appWith(db).inject({
      method: 'POST',
      url: '/v1/clubs/join',
      headers: auth,
      payload: { inviteCode: 'ABCDEFGHJK' }
    });

    expect(response.statusCode).toBe(403);
    // So a paused account cannot use the join route to test whether a code is
    // real.
    expect(db.sql()).not.toContain('SELECT id, name, invite_code FROM clubs');
  });

  it('refuses opening a 1v1 challenge', async () => {
    const db = paused();
    const response = await appWith(db).inject({
      method: 'POST',
      url: '/v1/challenges',
      headers: auth,
      payload: { friendAccountId: RAVI, mode: 'active_minutes', lengthDays: 7 }
    });

    expect(response.statusCode).toBe(403);
    expect(db.sql()).not.toContain('INSERT INTO challenges');
  });

  it('refuses joining a club challenge', async () => {
    const db = paused();
    const response = await appWith(db).inject({
      method: 'PUT',
      url: `/v1/clubs/${CLUB}/challenges/${CHALLENGE}/participation`,
      headers: auth,
      payload: { participating: true }
    });

    expect(response.statusCode).toBe(403);
    expect(db.sql()).not.toContain('INSERT INTO club_challenge_participants');
  });

  it('refuses entering a competition', async () => {
    const db = paused();
    const response = await appWith(db).inject({
      method: 'PUT',
      url: `/v1/competitions/${COMPETITION}/enrollment`,
      headers: auth,
      payload: { enrolled: true }
    });

    expect(response.statusCode).toBe(403);
    expect(db.sql()).not.toContain('INSERT INTO competition_enrollments');
  });
});

describe('a paused account is never trapped', () => {
  const paused = () => fakeDatabase({ sanctions: [suspension()], clubRole: 'member' });

  it('may still leave the global board', async () => {
    const db = paused();
    const response = await appWith(db).inject({
      method: 'PUT',
      url: '/v1/boards/global/participation',
      headers: auth,
      payload: { participating: false }
    });

    expect(response.statusCode).toBe(200);
    expect(db.sql()).toContain('UPDATE leaderboard_opt_ins SET revoked_at = now()');
  });

  it('may still leave a club challenge', async () => {
    const db = paused();
    const response = await appWith(db).inject({
      method: 'PUT',
      url: `/v1/clubs/${CLUB}/challenges/${CHALLENGE}/participation`,
      headers: auth,
      payload: { participating: false }
    });

    expect(response.statusCode).toBe(200);
    expect(db.sql()).toContain('UPDATE club_challenge_participants SET left_at = now()');
  });

  it('may still withdraw from a competition', async () => {
    const db = paused();
    const response = await appWith(db).inject({
      method: 'PUT',
      url: `/v1/competitions/${COMPETITION}/enrollment`,
      headers: auth,
      payload: { enrolled: false }
    });

    expect(response.statusCode).toBe(200);
    expect(db.sql()).toContain('UPDATE competition_enrollments SET withdrawn_at = now()');
  });

  it('may still read its own club', async () => {
    const db = paused();
    const response = await appWith(db).inject({
      method: 'GET',
      url: `/v1/clubs/${CLUB}/members`,
      headers: auth
    });

    // A suspension pauses what is published, not membership or reading.
    expect(response.statusCode).toBe(200);
  });
});

describe('a warning changes nothing', () => {
  it('leaves every publishing act available', async () => {
    const db = fakeDatabase({
      sanctions: [
        { kind: 'warning', statement: 'Keep it civil.', expires_at: null, revoked_at: null }
      ]
    });
    const response = await appWith(db).inject({
      method: 'PUT',
      url: '/v1/boards/global/participation',
      headers: auth,
      payload: { participating: true }
    });

    expect(response.statusCode).toBe(200);
    expect(db.sql()).toContain('INSERT INTO leaderboard_opt_ins');
  });
});

describe('other people stop seeing a paused account', () => {
  /**
   * A suspension that only stopped *new* participation would leave the account
   * on every board it had already joined. These assert the read paths filter,
   * which is what makes a pause a pause.
   */
  const filtersSuspended = (sql: string | undefined) => {
    expect(sql).toContain('FROM sanctions suspension');
    expect(sql).toContain("suspension.kind IN ('social_suspension', 'account_suspension')");
    expect(sql).toContain('suspension.revoked_at IS NULL');
    expect(sql).toContain('suspension.expires_at > now()');
  };

  it('drops it from the global board page', async () => {
    const db = fakeDatabase();
    await appWith(db).inject({ method: 'GET', url: '/v1/boards/global', headers: auth });

    filtersSuspended(
      db.calls.find(
        (call) => call.sql.includes('FROM global_board_entries entry') && call.sql.includes('LIMIT')
      )?.sql
    );
  });

  it('drops it from a club board', async () => {
    const db = fakeDatabase({ clubRole: 'member' });
    await appWith(db).inject({ method: 'GET', url: `/v1/clubs/${CLUB}/board`, headers: auth });

    filtersSuspended(
      db.calls.find((call) => call.sql.includes('JOIN leaderboard_opt_ins optin'))?.sql
    );
  });

  it('drops it from a friend board', async () => {
    const db = fakeDatabase();
    await appWith(db).inject({ method: 'GET', url: '/v1/friends/standings', headers: auth });

    filtersSuspended(db.calls.find((call) => call.sql.includes('WITH mutual AS'))?.sql);
  });

  it('drops it from club challenge standings', async () => {
    const db = fakeDatabase({ clubRole: 'member' });
    await appWith(db).inject({
      method: 'GET',
      url: `/v1/clubs/${CLUB}/challenges/${CHALLENGE}/standings`,
      headers: auth
    });

    filtersSuspended(
      db.calls.find((call) => call.sql.includes('FROM club_challenge_participants participant'))
        ?.sql
    );
  });

  it('drops it from competition standings', async () => {
    const db = fakeDatabase();
    await appWith(db).inject({
      method: 'GET',
      url: `/v1/competitions/${COMPETITION}/standings`,
      headers: auth
    });

    filtersSuspended(
      db.calls.find((call) => call.sql.includes('FROM competition_enrollments enrollment'))?.sql
    );
  });
});

describe('sign-in', () => {
  it('is refused for a suspended account, after the password checks out', async () => {
    const db = fakeDatabase({ sanctions: [suspension('account_suspension')] });
    // No account row is returned by the fake, so this exercises the ordering:
    // credentials are answered generically before any sanction is read.
    const response = await appWith(db).inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'me@example.com', password: 'not-the-password' }
    });

    expect(response.statusCode).toBe(401);
    // Sign-in must never become a way to test whether somebody else has been
    // suspended, so nothing is read about sanctions on a failed password.
    expect(db.sql()).not.toContain('FROM sanctions');
  });
});
