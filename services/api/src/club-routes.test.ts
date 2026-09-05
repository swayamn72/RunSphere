import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '@runsphere/db';
import { buildApp } from './app.js';
import { createAccessToken } from './auth.js';

const SECRET = 'club-routes-test-secret';
const ME = '00000000-0000-4000-8000-00000000000a';
const RAVI = '00000000-0000-4000-8000-00000000000b';
const ANA = '00000000-0000-4000-8000-00000000000c';
const CLUB = '00000000-0000-4000-8000-0000000000c1';
const RELAY = '00000000-0000-4000-8000-0000000000r1'.replace('r', 'e');

type Role = 'owner' | 'admin' | 'member';

const memberRow = (accountId: string, role: Role, displayName: string | null, blocked = false) => ({
  account_id: accountId,
  display_name: displayName,
  cosmetic: displayName ? { avatarKey: 'loop-1' } : null,
  activity_visibility: 'private',
  role,
  joined_at: new Date('2026-09-01T10:00:00.000Z'),
  blocked_either_way: blocked
});

interface Stubs {
  /** Role the caller holds in a live club; undefined means no access. */
  myRole?: Role;
  targetRole?: Role;
  memberCount?: number;
  clubs?: Record<string, unknown>[];
  members?: Record<string, unknown>[];
  joinable?: { id: string; name: string; invite_code: string } | undefined;
  joinConflict?: boolean;
  archived?: Record<string, unknown>[];
  /** Published club-relay rule rows; `[]` means none is published. */
  clubRule?: Record<string, unknown>[];
  relayRows?: Record<string, unknown>[];
  /** The caller's own live opt-in in the `club` board scope. */
  boardParticipating?: boolean;
  /** Published progression rule rows; `[]` means none is published. */
  progressionRule?: Record<string, unknown>[];
  /** Members with a live `club` opt-in, as the board query returns them. */
  boardMembers?: Record<string, unknown>[];
  activities?: Record<string, unknown>[];
  /** Published club-challenge rule rows; `[]` means none is published. */
  clubChallengeRule?: Record<string, unknown>[];
  /** `true` makes the one-live-challenge-per-club index reject the insert. */
  openConflict?: boolean;
  /** The challenge one club lookup returns; `[]` means no such challenge. */
  challenge?: Record<string, unknown>[];
  challengeStatus?: 'active' | 'finished' | 'cancelled';
  challengeCounts?: { count: string; joined: boolean };
  challengeParticipants?: Record<string, unknown>[];
  cancelled?: Record<string, unknown>[];
}

const CHALLENGE_ID = '00000000-0000-4000-8000-0000000000d1';

const challengeRow = (overrides: Record<string, unknown> = {}) => ({
  id: CHALLENGE_ID,
  club_id: '00000000-0000-4000-8000-0000000000c1',
  mode: 'active_minutes',
  length_days: 7,
  status: 'active',
  period_start: '2026-08-31',
  period_end: '2026-09-07',
  rule_version: 1,
  created_at: new Date('2026-08-31T04:00:00.000Z'),
  ...overrides
});

const PROGRESSION_RULE = {
  xpPerActiveMinute: 1,
  xpPerActiveDay: 20,
  dailyCapMinutes: 240,
  minMinutesPerActiveDay: 1,
  goalActiveDays: 3,
  levels: [0, 100, 250]
};

const boardMemberRow = (accountId: string, displayName: string | null, blocked = false) => ({
  account_id: accountId,
  display_name: displayName,
  cosmetic: displayName ? { avatarKey: 'loop-1' } : null,
  activity_visibility: 'private',
  blocked_either_way: blocked
});

const activityRow = (accountId: string, minutes: number, processedAt: Date | string) => ({
  account_id: accountId,
  active_duration_seconds: minutes * 60,
  processed_at: new Date(processedAt)
});

const fakeDatabase = (stubs: Stubs = {}) => {
  const calls: { sql: string; values: readonly unknown[] | undefined }[] = [];
  let roleLookups = 0;
  const respond = (sql: string, values?: readonly unknown[]) => {
    if (sql.includes('SELECT membership.role FROM club_memberships')) {
      // The routes look the caller up first, then the target.
      roleLookups += 1;
      const role = roleLookups === 1 ? stubs.myRole : stubs.targetRole;
      return { rows: role ? [{ role }] : [] };
    }
    if (sql.includes('AS participating'))
      return { rows: [{ participating: stubs.boardParticipating ?? true }] };
    if (sql.includes("kind = 'progression'"))
      return { rows: stubs.progressionRule ?? [{ version: 4, definition: PROGRESSION_RULE }] };
    // Checked before the roster: the board query is also a membership select
    // with a block probe, and only the opt-in join tells the two apart.
    if (sql.includes('JOIN leaderboard_opt_ins optin')) return { rows: stubs.boardMembers ?? [] };
    if (sql.includes('FROM activity_submissions')) return { rows: stubs.activities ?? [] };
    if (sql.includes("kind = 'club_challenge'"))
      return {
        rows: stubs.clubChallengeRule ?? [
          {
            version: 1,
            definition: {
              dailyCapMinutes: 240,
              minMinutesPerActiveDay: 1,
              lengthDays: [7, 14],
              modes: ['active_minutes', 'active_days']
            }
          }
        ]
      };
    if (sql.includes('INSERT INTO club_challenges'))
      return {
        rows: stubs.openConflict
          ? []
          : [
              challengeRow({
                mode: values?.[1] ?? 'active_minutes',
                length_days: values?.[2] ?? 7,
                rule_version: values?.[4] ?? 1
              })
            ]
      };
    if (sql.includes('UPDATE club_challenges SET'))
      return { rows: stubs.cancelled ?? [challengeRow({ status: 'cancelled' })] };
    if (sql.includes('FROM club_challenges challenge')) return { rows: stubs.challenge ?? [] };
    if (sql.includes('FROM club_challenges WHERE id'))
      return {
        rows: stubs.challenge ?? [challengeRow({ status: stubs.challengeStatus ?? 'active' })]
      };
    if (sql.includes('FROM club_challenge_participants participant'))
      return { rows: stubs.challengeParticipants ?? [] };
    if (sql.includes('FROM club_challenge_participants WHERE challenge_id'))
      return {
        rows: [
          {
            participant_count: stubs.challengeCounts?.count ?? '2',
            joined: stubs.challengeCounts?.joined ?? true
          }
        ]
      };
    if (sql.includes('count(*)::text AS count')) {
      return { rows: [{ count: String(stubs.memberCount ?? 1) }] };
    }
    if (sql.includes('FROM clubs club')) return { rows: stubs.clubs ?? [] };
    if (sql.includes("kind = 'club'"))
      return {
        rows: stubs.clubRule ?? [
          {
            version: 1,
            definition: {
              dailyCapMinutes: 240,
              memberWeeklyCapMinutes: 600,
              minTargetUnits: 60,
              maxTargetUnits: 20000
            }
          }
        ]
      };
    if (sql.includes('FROM club_relays relay')) return { rows: stubs.relayRows ?? [] };
    if (sql.includes('INSERT INTO club_relays'))
      return {
        rows: [
          {
            id: RELAY,
            period_start: '2026-08-31',
            period_end: '2026-09-07',
            target_units: values?.[2] ?? 600,
            rule_version: values?.[3] ?? 1
          }
        ]
      };
    if (sql.includes('FROM club_relay_contributions'))
      return { rows: [{ total_units: '0', contributor_count: '0', my_units: '0' }] };
    if (sql.includes('FROM club_memberships membership') && sql.includes('blocked_either_way'))
      return { rows: stubs.members ?? [] };
    if (sql.includes('SELECT id, name, invite_code FROM clubs'))
      return { rows: stubs.joinable ? [stubs.joinable] : [] };
    if (sql.includes('INSERT INTO club_memberships'))
      return { rows: stubs.joinConflict ? [] : [{ role: 'member' }] };
    if (sql.includes('INSERT INTO clubs'))
      return { rows: [{ id: CLUB, invite_code: 'ABCDEFGHJK' }] };
    if (sql.includes('UPDATE clubs SET archived_at'))
      return {
        rows: stubs.archived ?? [
          {
            id: CLUB,
            name: 'Morning Movers',
            invite_code: 'ABCDEFGHJK',
            archived_at: new Date('2026-09-04T10:00:00.000Z'),
            member_count: '3'
          }
        ]
      };
    if (sql.includes('UPDATE club_memberships membership SET role'))
      return {
        rows: [
          {
            role: (values?.[2] as Role) ?? 'admin',
            joined_at: new Date('2026-09-01T10:00:00.000Z'),
            display_name: 'Ravi',
            cosmetic: { avatarKey: 'loop-1' },
            activity_visibility: 'private'
          }
        ]
      };
    return { rows: [] };
  };
  const query = vi.fn(async (sql: string, values?: readonly unknown[]) => {
    calls.push({ sql, values });
    return respond(sql, values);
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

describe('POST /v1/clubs', () => {
  it('makes the creator the owner in the same transaction as the club', async () => {
    const db = fakeDatabase();
    const response = await appWith(db).inject({
      method: 'POST',
      url: '/v1/clubs',
      headers: auth,
      payload: { name: '  Morning   Movers ' }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      id: CLUB,
      name: 'Morning Movers',
      role: 'owner',
      memberCount: 1,
      inviteCode: 'ABCDEFGHJK'
    });
    const statements = db.calls.map((call) => call.sql);
    // The club and its owner row are written inside one transaction. The
    // sanction check runs before it opens, which is why this looks for BEGIN
    // rather than assuming it is the first statement of the request.
    const begin = statements.indexOf('BEGIN');
    expect(begin).toBeGreaterThanOrEqual(0);
    expect(statements.slice(begin).some((sql) => sql.includes("VALUES ($1, $2, 'owner')"))).toBe(
      true
    );
    expect(statements.at(-1) === 'COMMIT' || statements.includes('COMMIT')).toBe(true);
  });

  it('generates the invite code server-side rather than accepting one', async () => {
    const db = fakeDatabase();
    const response = await appWith(db).inject({
      method: 'POST',
      url: '/v1/clubs',
      headers: auth,
      payload: { name: 'Movers', inviteCode: 'CHOSENCODE' }
    });

    expect(response.statusCode).toBe(201);
    const insert = db.calls.find((call) => call.sql.includes('INSERT INTO clubs'))!;
    expect(insert.values?.[1]).not.toBe('CHOSENCODE');
    expect(String(insert.values?.[1])).toMatch(/^[A-HJ-KM-NP-Z2-9]{10}$/);
  });

  it('refuses a name that is only whitespace', async () => {
    const db = fakeDatabase();
    const response = await appWith(db).inject({
      method: 'POST',
      url: '/v1/clubs',
      headers: auth,
      payload: { name: '   ' }
    });

    expect(response.statusCode).toBe(400);
    expect(db.sql()).not.toContain('INSERT INTO clubs');
  });
});

describe('GET /v1/clubs', () => {
  it('lists only live clubs the caller is an active member of', async () => {
    const db = fakeDatabase({
      clubs: [
        {
          id: CLUB,
          name: 'Morning Movers',
          invite_code: 'ABCDEFGHJK',
          archived_at: null,
          role: 'admin',
          member_count: '4'
        }
      ]
    });
    const response = await appWith(db).inject({ method: 'GET', url: '/v1/clubs', headers: auth });

    expect(response.json()).toEqual({
      data: [
        {
          id: CLUB,
          name: 'Morning Movers',
          role: 'admin',
          memberCount: 4,
          inviteCode: 'ABCDEFGHJK'
        }
      ]
    });
    const select = db.calls.find((call) => call.sql.includes('FROM clubs club'))!;
    expect(select.sql).toContain('membership.account_id = $1');
    expect(select.sql).toContain('membership.left_at IS NULL');
    expect(select.sql).toContain('club.archived_at IS NULL');
    expect(select.values).toEqual([ME]);
  });

  it('answers an empty list rather than anything public', async () => {
    const response = await appWith(fakeDatabase()).inject({
      method: 'GET',
      url: '/v1/clubs',
      headers: auth
    });
    expect(response.json()).toEqual({ data: [] });
  });
});

describe('POST /v1/clubs/join', () => {
  const join = (db: ReturnType<typeof fakeDatabase>, inviteCode: string) =>
    appWith(db).inject({
      method: 'POST',
      url: '/v1/clubs/join',
      headers: auth,
      payload: { inviteCode }
    });

  it('joins by exact code, normalising what the person typed', async () => {
    const db = fakeDatabase({
      joinable: { id: CLUB, name: 'Morning Movers', invite_code: 'ABCDEFGHJK' },
      memberCount: 5
    });
    const response = await join(db, ' abcdefghjk ');

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: CLUB, role: 'member', memberCount: 5 });
    const lookup = db.calls.find((call) =>
      call.sql.includes('SELECT id, name, invite_code FROM clubs')
    )!;
    expect(lookup.values).toEqual(['ABCDEFGHJK']);
    expect(lookup.sql).toContain('archived_at IS NULL');
  });

  it('reactivates a previous membership instead of duplicating it', async () => {
    const db = fakeDatabase({
      joinable: { id: CLUB, name: 'Morning Movers', invite_code: 'ABCDEFGHJK' }
    });
    await join(db, 'ABCDEFGHJK');

    const insert = db.calls.find((call) => call.sql.includes('INSERT INTO club_memberships'))!;
    expect(insert.sql).toContain('ON CONFLICT (club_id, account_id) DO UPDATE');
    expect(insert.sql).toContain('left_at = NULL');
    expect(insert.sql).toContain('club_memberships.left_at IS NOT NULL');
  });

  it('answers 409 when the caller is already an active member', async () => {
    const db = fakeDatabase({
      joinable: { id: CLUB, name: 'Morning Movers', invite_code: 'ABCDEFGHJK' },
      joinConflict: true
    });
    const response = await join(db, 'ABCDEFGHJK');

    expect(response.statusCode).toBe(409);
  });

  it('answers 404 for an unknown or archived code, revealing nothing', async () => {
    const response = await join(fakeDatabase({ joinable: undefined }), 'ZZZZZZZZZZ');
    expect(response.statusCode).toBe(404);
    expect(response.json().message).toBe('Club not found');
  });

  it('rejects an impossible code without touching the database', async () => {
    const db = fakeDatabase();
    // '0' and 'O' are not in the alphabet, so this cannot be a real code.
    const response = await join(db, '0OOOO0');

    expect(response.statusCode).toBe(404);
    expect(db.sql()).not.toContain('FROM clubs');
  });
});

describe('GET /v1/clubs/:clubId/members', () => {
  const members = (db: ReturnType<typeof fakeDatabase>) =>
    appWith(db).inject({ method: 'GET', url: `/v1/clubs/${CLUB}/members`, headers: auth });

  it('answers 404 to a non-member rather than confirming the club exists', async () => {
    const db = fakeDatabase({ myRole: undefined });
    const response = await members(db);

    expect(response.statusCode).toBe(404);
    expect(db.sql()).not.toContain('blocked_either_way');
  });

  it('returns each member as a profile and a role, and nothing more', async () => {
    const db = fakeDatabase({
      myRole: 'member',
      members: [memberRow(ME, 'member', 'Maya'), memberRow(RAVI, 'owner', 'Ravi')]
    });
    const response = await members(db);

    expect(response.statusCode).toBe(200);
    expect(response.json().data[1]).toEqual({
      profile: {
        id: RAVI,
        displayName: 'Ravi',
        cosmetic: { avatarKey: 'loop-1' },
        activityVisibility: 'private'
      },
      role: 'owner',
      joinedAt: '2026-09-01T10:00:00.000Z'
    });
    expect(response.body).not.toContain('email');
  });

  it('omits an account blocked in either direction, but keeps the reader', async () => {
    const db = fakeDatabase({
      myRole: 'member',
      members: [
        memberRow(ME, 'member', 'Maya', true),
        memberRow(RAVI, 'owner', 'Ravi', true),
        memberRow(ANA, 'member', 'Ana')
      ]
    });
    const response = await members(db);

    expect(
      response.json().data.map((entry: { profile: { id: string } }) => entry.profile.id)
    ).toEqual([ME, ANA]);
  });

  it('keeps a member with no display name addressable', async () => {
    const db = fakeDatabase({ myRole: 'member', members: [memberRow(ANA, 'member', null)] });
    const response = await members(db);

    expect(response.json().data[0].profile.displayName).toBe('RunSphere member');
    expect(response.json().data[0].profile.cosmetic).toEqual({ avatarKey: 'default' });
  });

  it('excludes accounts that have been erased', async () => {
    const db = fakeDatabase({ myRole: 'member' });
    await members(db);

    const select = db.calls.find((call) => call.sql.includes('blocked_either_way'))!;
    expect(select.sql).toContain('account.deleted_at IS NULL');
    expect(select.sql).toContain('membership.left_at IS NULL');
  });
});

describe('DELETE /v1/clubs/:clubId/membership', () => {
  const leave = (db: ReturnType<typeof fakeDatabase>) =>
    appWith(db).inject({ method: 'DELETE', url: `/v1/clubs/${CLUB}/membership`, headers: auth });

  it('records a departure without deleting the membership history', async () => {
    const db = fakeDatabase({ myRole: 'member', memberCount: 4 });
    const response = await leave(db);

    expect(response.statusCode).toBe(204);
    const update = db.calls.find((call) =>
      call.sql.includes('UPDATE club_memberships SET left_at')
    )!;
    expect(update.sql).toContain("left_reason = 'left'");
    expect(update.sql).not.toContain('DELETE');
    expect(update.values).toEqual([CLUB, ME]);
  });

  it('holds the owner while the club still has other members', async () => {
    const db = fakeDatabase({ myRole: 'owner', memberCount: 3 });
    const response = await leave(db);

    expect(response.statusCode).toBe(409);
    expect(db.sql()).not.toContain('UPDATE club_memberships SET left_at');
  });

  it('lets the last remaining owner leave', async () => {
    const db = fakeDatabase({ myRole: 'owner', memberCount: 1 });
    expect((await leave(db)).statusCode).toBe(204);
  });

  it('answers 404 when the caller is not an active member', async () => {
    expect((await leave(fakeDatabase({ myRole: undefined }))).statusCode).toBe(404);
  });
});

describe('DELETE /v1/clubs/:clubId/members/:accountId', () => {
  const remove = (db: ReturnType<typeof fakeDatabase>, target = RAVI) =>
    appWith(db).inject({
      method: 'DELETE',
      url: `/v1/clubs/${CLUB}/members/${target}`,
      headers: auth
    });

  it('lets an owner remove an admin, naming who did it', async () => {
    const db = fakeDatabase({ myRole: 'owner', targetRole: 'admin' });
    const response = await remove(db);

    expect(response.statusCode).toBe(204);
    const update = db.calls.find((call) => call.sql.includes("left_reason = 'removed'"))!;
    expect(update.values).toEqual([CLUB, RAVI, ME]);
  });

  it('refuses an admin removing a fellow admin', async () => {
    const db = fakeDatabase({ myRole: 'admin', targetRole: 'admin' });
    const response = await remove(db);

    expect(response.statusCode).toBe(403);
    expect(db.sql()).not.toContain("left_reason = 'removed'");
  });

  it('refuses removing the owner', async () => {
    expect((await remove(fakeDatabase({ myRole: 'admin', targetRole: 'owner' }))).statusCode).toBe(
      403
    );
  });

  it('refuses a plain member removing anyone', async () => {
    expect(
      (await remove(fakeDatabase({ myRole: 'member', targetRole: 'member' }))).statusCode
    ).toBe(403);
  });

  it('does not double as leaving', async () => {
    const db = fakeDatabase({ myRole: 'owner', targetRole: 'owner' });
    expect((await remove(db, ME)).statusCode).toBe(403);
  });

  it('answers 404 for a target who is not an active member', async () => {
    expect(
      (await remove(fakeDatabase({ myRole: 'owner', targetRole: undefined }))).statusCode
    ).toBe(404);
  });
});

describe('PATCH /v1/clubs/:clubId/members/:accountId', () => {
  const setRole = (db: ReturnType<typeof fakeDatabase>, role: string, target = RAVI) =>
    appWith(db).inject({
      method: 'PATCH',
      url: `/v1/clubs/${CLUB}/members/${target}`,
      headers: auth,
      payload: { role }
    });

  it('lets the owner promote a member to admin', async () => {
    const db = fakeDatabase({ myRole: 'owner', targetRole: 'member' });
    const response = await setRole(db, 'admin');

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ role: 'admin', profile: { id: RAVI } });
  });

  it('refuses an admin changing anyone role', async () => {
    const db = fakeDatabase({ myRole: 'admin', targetRole: 'member' });
    expect((await setRole(db, 'admin')).statusCode).toBe(403);
  });

  it('refuses granting owner through a role edit', async () => {
    const db = fakeDatabase({ myRole: 'owner', targetRole: 'member' });
    const response = await setRole(db, 'owner');

    expect(response.statusCode).toBe(400);
    expect(db.sql()).not.toContain('UPDATE club_memberships membership SET role');
  });

  it('refuses the owner editing their own row', async () => {
    const db = fakeDatabase({ myRole: 'owner', targetRole: 'owner' });
    expect((await setRole(db, 'admin', ME)).statusCode).toBe(403);
  });
});

describe('POST /v1/clubs/:clubId/archive', () => {
  const archive = (db: ReturnType<typeof fakeDatabase>) =>
    appWith(db).inject({ method: 'POST', url: `/v1/clubs/${CLUB}/archive`, headers: auth });

  it('archives rather than deletes, keeping the membership record', async () => {
    const db = fakeDatabase({ myRole: 'owner' });
    const response = await archive(db);

    expect(response.statusCode).toBe(200);
    expect(response.json().archivedAt).toBe('2026-09-04T10:00:00.000Z');
    expect(db.sql()).not.toContain('DELETE FROM clubs');
    expect(db.sql()).not.toContain('DELETE FROM club_memberships');
  });

  it('is the owner alone', async () => {
    expect((await archive(fakeDatabase({ myRole: 'admin' }))).statusCode).toBe(403);
    expect((await archive(fakeDatabase({ myRole: 'member' }))).statusCode).toBe(403);
  });

  it('answers 404 for a club already archived', async () => {
    const db = fakeDatabase({ myRole: 'owner', archived: [] });
    expect((await archive(db)).statusCode).toBe(404);
  });
});

describe('POST /v1/clubs/:clubId/relays', () => {
  const setRelay = (db: ReturnType<typeof fakeDatabase>, targetUnits: unknown) =>
    appWith(db).inject({
      method: 'POST',
      url: `/v1/clubs/${CLUB}/relays`,
      headers: auth,
      payload: { targetUnits }
    });

  it('sets this week target and reads back honest zeroes until the worker runs', async () => {
    const db = fakeDatabase({ myRole: 'admin' });
    const response = await setRelay(db, 600);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      targetUnits: 600,
      totalUnits: 0,
      myUnits: 0,
      contributorCount: 0,
      progressPercent: 0,
      goalMet: false,
      current: true,
      ruleVersion: 1
    });
  });

  it('never takes the week from the caller, so a scored week cannot be retargeted', async () => {
    const db = fakeDatabase({ myRole: 'owner' });
    await appWith(db).inject({
      method: 'POST',
      url: `/v1/clubs/${CLUB}/relays`,
      headers: auth,
      payload: { targetUnits: 600, periodStart: '2020-01-06' }
    });

    const insert = db.calls.find((call) => call.sql.includes('INSERT INTO club_relays'))!;
    expect(insert.values).not.toContain('2020-01-06');
    expect(insert.sql).toContain('ON CONFLICT (club_id, period_start) DO UPDATE');
  });

  it('is the owner or an admin, never a plain member', async () => {
    expect((await setRelay(fakeDatabase({ myRole: 'member' }), 600)).statusCode).toBe(403);
    expect((await setRelay(fakeDatabase({ myRole: 'admin' }), 600)).statusCode).toBe(200);
  });

  it('answers 404 to a non-member rather than confirming the club exists', async () => {
    expect((await setRelay(fakeDatabase({ myRole: undefined }), 600)).statusCode).toBe(404);
  });

  it('refuses a target outside the published rule with a 422', async () => {
    const db = fakeDatabase({ myRole: 'owner' });
    const response = await setRelay(db, 10);

    expect(response.statusCode).toBe(422);
    expect(response.json().message).toContain('between 60 and 20000');
    expect(db.sql()).not.toContain('INSERT INTO club_relays');
  });

  it('reports an unpublished rule rather than inventing a default', async () => {
    const db = fakeDatabase({ myRole: 'owner', clubRule: [] });
    const response = await setRelay(db, 600);

    expect(response.statusCode).toBe(422);
    expect(response.json().message).toBe('No club relay rule is published');
  });

  it('rejects a target the contract itself forbids', async () => {
    const db = fakeDatabase({ myRole: 'owner' });
    expect((await setRelay(db, 0)).statusCode).toBe(400);
    expect((await setRelay(db, 'lots')).statusCode).toBe(400);
  });
});

describe('GET /v1/clubs/:clubId/relays', () => {
  const relays = (db: ReturnType<typeof fakeDatabase>) =>
    appWith(db).inject({ method: 'GET', url: `/v1/clubs/${CLUB}/relays`, headers: auth });

  it('returns aggregates plus the reader own units, and no breakdown', async () => {
    const db = fakeDatabase({
      myRole: 'member',
      // A week long past, so `current` is false whenever this test runs.
      relayRows: [
        {
          id: RELAY,
          period_start: '2020-01-06',
          period_end: '2020-01-13',
          target_units: 600,
          rule_version: 1,
          total_units: '450',
          contributor_count: '3',
          my_units: '75'
        }
      ]
    });
    const response = await relays(db);

    expect(response.statusCode).toBe(200);
    expect(response.json().data[0]).toEqual({
      id: RELAY,
      periodStart: '2020-01-06',
      periodEnd: '2020-01-13',
      targetUnits: 600,
      totalUnits: 450,
      myUnits: 75,
      contributorCount: 3,
      progressPercent: 75,
      goalMet: false,
      current: false,
      ruleVersion: 1
    });
    // Nothing that could identify another member's contribution.
    expect(response.body).not.toContain('account_id');
    expect(response.body).not.toContain('accountId');
  });

  it('reports a met goal without reporting how far past it the club went', async () => {
    const db = fakeDatabase({
      myRole: 'member',
      relayRows: [
        {
          id: RELAY,
          period_start: '2020-01-06',
          period_end: '2020-01-13',
          target_units: 600,
          rule_version: 1,
          total_units: '1800',
          contributor_count: '4',
          my_units: '0'
        }
      ]
    });
    const summary = (await relays(db)).json().data[0];

    expect(summary.goalMet).toBe(true);
    expect(summary.progressPercent).toBe(100);
  });

  it('answers 404 to a non-member without reading any relay', async () => {
    const db = fakeDatabase({ myRole: undefined });
    expect((await relays(db)).statusCode).toBe(404);
    expect(db.sql()).not.toContain('FROM club_relays relay');
  });

  it('reads the reader own units by their own account id alone', async () => {
    const db = fakeDatabase({ myRole: 'member' });
    await relays(db);

    const select = db.calls.find((call) => call.sql.includes('FROM club_relays relay'))!;
    expect(select.values).toEqual([CLUB, ME]);
    expect(select.sql).toContain('FILTER (WHERE contribution.account_id = $2)');
  });
});

describe('club sessions', () => {
  it('refuses every club route without a usable session', async () => {
    const db = fakeDatabase({ myRole: 'owner' });
    const app = appWith(db);
    const missing = await app.inject({ method: 'GET', url: '/v1/clubs' });
    expect(missing.statusCode).toBe(400);

    const invalid = await app.inject({
      method: 'GET',
      url: '/v1/clubs',
      headers: { authorization: 'Bearer not-a-real-token' }
    });
    expect(invalid.statusCode).toBe(401);
    expect(db.sql()).not.toContain('FROM clubs club');
  });
});

describe('GET /v1/clubs/:clubId/board', () => {
  const board = (db: ReturnType<typeof fakeDatabase>) =>
    appWith(db).inject({ method: 'GET', url: `/v1/clubs/${CLUB}/board`, headers: auth });

  /** The Kolkata week is whatever week the test runs in, so instants come from the route. */
  const weekStartFrom = (db: ReturnType<typeof fakeDatabase>): Date =>
    db.calls.find((call) => call.sql.includes('FROM activity_submissions'))?.values?.[1] as Date;

  it('answers 404 to a non-member without reading anyone opt-in state', async () => {
    const db = fakeDatabase({ myRole: undefined });
    const response = await board(db);

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ message: 'Club not found' });
    expect(db.sql()).not.toContain('leaderboard_opt_ins');
  });

  it('shows no entries to a member who is not on the board', async () => {
    const db = fakeDatabase({ myRole: 'member', boardParticipating: false });
    const response = await board(db);

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({ clubId: CLUB, participating: false, entries: [] });
    expect(body.ruleVersion).toBeUndefined();
    // Reading other members' scores requires publishing your own.
    expect(db.sql()).not.toContain('FROM activity_submissions');
    expect(db.sql()).not.toContain('JOIN leaderboard_opt_ins optin');
  });

  it('ranks opted-in members of this club by capped weekly active minutes', async () => {
    const probe = fakeDatabase({
      myRole: 'member',
      boardMembers: [boardMemberRow(ME, 'Maya'), boardMemberRow(RAVI, 'Ravi')]
    });
    await board(probe);
    const weekStart = weekStartFrom(probe);

    const db = fakeDatabase({
      myRole: 'member',
      boardMembers: [
        boardMemberRow(ME, 'Maya'),
        boardMemberRow(RAVI, 'Ravi'),
        boardMemberRow(ANA, 'Ana')
      ],
      activities: [
        activityRow(RAVI, 200, weekStart),
        activityRow(ME, 90, weekStart),
        activityRow(ME, 30, weekStart)
      ]
    });
    const response = await board(db);

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
    // The board is one club's board: the member query is filtered by club id.
    const members = db.calls.find((call) => call.sql.includes('JOIN leaderboard_opt_ins optin'))!;
    expect(members.values?.[0]).toBe(CLUB);
    expect(members.sql).toContain('membership.club_id = $1');
    expect(members.sql).toContain('membership.left_at IS NULL');
  });

  it('gives tied scores the same rank and skips the next one', async () => {
    const probe = fakeDatabase({ myRole: 'member', boardMembers: [boardMemberRow(ME, 'Maya')] });
    await board(probe);
    const weekStart = weekStartFrom(probe);

    const db = fakeDatabase({
      myRole: 'member',
      boardMembers: [
        boardMemberRow(ME, 'Maya'),
        boardMemberRow(RAVI, 'Ravi'),
        boardMemberRow(ANA, 'Ana')
      ],
      activities: [
        activityRow(ME, 60, weekStart),
        activityRow(RAVI, 60, weekStart),
        activityRow(ANA, 10, weekStart)
      ]
    });
    const response = await board(db);

    expect(response.json().entries.map((entry: { rank: number }) => entry.rank)).toEqual([1, 1, 3]);
  });

  it('hides a blocked member from the board in either direction', async () => {
    const db = fakeDatabase({
      myRole: 'member',
      boardMembers: [boardMemberRow(ME, 'Maya'), boardMemberRow(RAVI, 'Ravi', true)]
    });
    const response = await board(db);

    const body = response.json();
    expect(body.entries.map((entry: { profile: { id: string } }) => entry.profile.id)).toEqual([
      ME
    ]);
    // The blocked member is not scored either: they never reach the score query.
    const activities = db.calls.find((call) => call.sql.includes('FROM activity_submissions'))!;
    expect(activities.values?.[0]).toEqual([ME]);
  });

  it('returns an empty board rather than zeroes when no progression rule is published', async () => {
    const db = fakeDatabase({ myRole: 'member', progressionRule: [] });
    const response = await board(db);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ participating: true, entries: [] });
    expect(response.json().ruleVersion).toBeUndefined();
    expect(db.sql()).not.toContain('FROM activity_submissions');
  });

  it('never reads route, location, pace, or distance for a board entry', async () => {
    const db = fakeDatabase({
      myRole: 'member',
      boardMembers: [boardMemberRow(ME, 'Maya'), boardMemberRow(RAVI, null)]
    });
    await board(db);

    const sql = db.sql();
    for (const forbidden of ['route', 'geom', 'latitude', 'longitude', 'distance_meters', 'pace'])
      expect(sql).not.toContain(forbidden);
  });

  it('answers 401 to an unverifiable token before touching the club', async () => {
    const db = fakeDatabase({ myRole: 'member' });
    const response = await appWith(db).inject({
      method: 'GET',
      url: `/v1/clubs/${CLUB}/board`,
      headers: { authorization: 'Bearer not-a-real-token' }
    });

    expect(response.statusCode).toBe(401);
    expect(db.sql()).toBe('');
  });
});

describe('PUT /v1/clubs/board/participation', () => {
  it('opens the club scope opt-in and reopens a revoked one', async () => {
    const db = fakeDatabase();
    const response = await appWith(db).inject({
      method: 'PUT',
      url: '/v1/clubs/board/participation',
      headers: auth,
      payload: { participating: true }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ participating: true });
    const insert = db.calls.find((call) => call.sql.includes('INSERT INTO leaderboard_opt_ins'))!;
    expect(insert.sql).toContain("'club'");
    expect(insert.sql).toContain('DO UPDATE SET opted_in_at = now(), revoked_at = NULL');
    const audit = db.calls.find((call) => call.sql.includes('privacy_audit_events'))!;
    expect(audit.values?.[1]).toBe('club_board.joined');
  });

  it('revokes rather than deletes when a member leaves the board', async () => {
    const db = fakeDatabase();
    const response = await appWith(db).inject({
      method: 'PUT',
      url: '/v1/clubs/board/participation',
      headers: auth,
      payload: { participating: false }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ participating: false });
    expect(db.sql()).toContain('UPDATE leaderboard_opt_ins SET revoked_at = now()');
    expect(db.sql()).not.toContain('DELETE FROM leaderboard_opt_ins');
    const audit = db.calls.find((call) => call.sql.includes('privacy_audit_events'))!;
    expect(audit.values?.[1]).toBe('club_board.left');
  });

  it('does not accept a club id, because the decision is not per club', async () => {
    const db = fakeDatabase({ myRole: 'member' });
    const response = await appWith(db).inject({
      method: 'PUT',
      url: `/v1/clubs/${CLUB}/board/participation`,
      headers: auth,
      payload: { participating: true }
    });

    expect(response.statusCode).toBe(404);
    expect(db.sql()).not.toContain('leaderboard_opt_ins');
  });

  it('answers 401 to an unverifiable token without changing an opt-in', async () => {
    const db = fakeDatabase();
    const response = await appWith(db).inject({
      method: 'PUT',
      url: '/v1/clubs/board/participation',
      headers: { authorization: 'Bearer not-a-real-token' },
      payload: { participating: true }
    });

    expect(response.statusCode).toBe(401);
    expect(db.sql()).not.toContain('leaderboard_opt_ins');
  });
});

const CHALLENGE = '00000000-0000-4000-8000-0000000000d1';

describe('POST /v1/clubs/:clubId/challenges', () => {
  const open = (db: ReturnType<typeof fakeDatabase>, payload: Record<string, unknown>) =>
    appWith(db).inject({
      method: 'POST',
      url: `/v1/clubs/${CLUB}/challenges`,
      headers: auth,
      payload
    });

  it('opens a contest for the club without enrolling anybody in it', async () => {
    const db = fakeDatabase({ myRole: 'admin' });
    const response = await open(db, { mode: 'active_minutes', lengthDays: 7 });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      id: CHALLENGE,
      clubId: CLUB,
      mode: 'active_minutes',
      lengthDays: 7,
      status: 'active',
      participantCount: 0,
      joined: false,
      ruleVersion: 1
    });
    // Opening is a club-wide act; joining publishes a personal score, so the
    // member who opened it is not put in it.
    expect(db.sql()).not.toContain('INSERT INTO club_challenge_participants');
  });

  it('refuses a member who is not an owner or admin', async () => {
    const db = fakeDatabase({ myRole: 'member' });
    const response = await open(db, { mode: 'active_minutes', lengthDays: 7 });

    expect(response.statusCode).toBe(403);
    expect(db.sql()).not.toContain('INSERT INTO club_challenges');
  });

  it('answers 404 to a non-member rather than confirming the club', async () => {
    const db = fakeDatabase({ myRole: undefined });
    const response = await open(db, { mode: 'active_minutes', lengthDays: 7 });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ message: 'Club not found' });
  });

  it('answers 422 for a length the published rule does not allow', async () => {
    const db = fakeDatabase({ myRole: 'owner' });
    const response = await open(db, { mode: 'active_minutes', lengthDays: 3 });

    expect(response.statusCode).toBe(422);
    expect(response.json().message).toContain('7 or 14');
    expect(db.sql()).not.toContain('INSERT INTO club_challenges');
  });

  it('answers 422 when no club challenge rule is published', async () => {
    const db = fakeDatabase({ myRole: 'owner', clubChallengeRule: [] });
    const response = await open(db, { mode: 'active_minutes', lengthDays: 7 });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({ message: 'No club challenge rule is published' });
  });

  it('answers 409 when the club already has one running', async () => {
    const db = fakeDatabase({ myRole: 'owner', openConflict: true });
    const response = await open(db, { mode: 'active_days', lengthDays: 14 });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ message: 'This club already has a challenge running' });
  });

  it('starts the window today rather than anywhere the request asks for', async () => {
    const db = fakeDatabase({ myRole: 'owner' });
    await open(db, { mode: 'active_minutes', lengthDays: 7, periodStart: '2020-01-01' });

    const insert = db.calls.find((call) => call.sql.includes('INSERT INTO club_challenges'))!;
    // The window is derived, so a contest can neither be backdated over days
    // that already happened nor parked in the future.
    expect(insert.values).not.toContain('2020-01-01');
    expect(String(insert.values?.[3])).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(insert.sql).toContain('$4::date + $3');
  });
});

describe('PUT /v1/clubs/:clubId/challenges/:challengeId/participation', () => {
  const participate = (db: ReturnType<typeof fakeDatabase>, participating: boolean) =>
    appWith(db).inject({
      method: 'PUT',
      url: `/v1/clubs/${CLUB}/challenges/${CHALLENGE}/participation`,
      headers: auth,
      payload: { participating }
    });

  it('joins a running contest and reopens a place that was left', async () => {
    const db = fakeDatabase({ myRole: 'member', challengeCounts: { count: '4', joined: true } });
    const response = await participate(db, true);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ joined: true, participantCount: 4 });
    const insert = db.calls.find((call) =>
      call.sql.includes('INSERT INTO club_challenge_participants')
    )!;
    expect(insert.sql).toContain('DO UPDATE SET left_at = NULL');
  });

  it('leaves by recording the departure rather than deleting the row', async () => {
    const db = fakeDatabase({ myRole: 'member', challengeCounts: { count: '3', joined: false } });
    const response = await participate(db, false);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ joined: false });
    expect(db.sql()).toContain('UPDATE club_challenge_participants SET left_at = now()');
    expect(db.sql()).not.toContain('DELETE FROM club_challenge_participants');
  });

  it('refuses to change a contest whose window has closed', async () => {
    const db = fakeDatabase({ myRole: 'member', challengeStatus: 'finished' });
    const response = await participate(db, true);

    expect(response.statusCode).toBe(409);
    expect(db.sql()).not.toContain('INSERT INTO club_challenge_participants');
  });

  it('does not find a challenge belonging to another club', async () => {
    const db = fakeDatabase({ myRole: 'member', challenge: [] });
    const response = await participate(db, true);

    expect(response.statusCode).toBe(404);
    const lookup = db.calls.find((call) => call.sql.includes('FROM club_challenges WHERE id'))!;
    // The club id is part of the lookup, so a challenge id from another club
    // is simply not found rather than acted on.
    expect(lookup.values).toEqual([CHALLENGE, CLUB]);
  });
});

describe('POST /v1/clubs/:clubId/challenges/:challengeId/cancel', () => {
  const cancel = (db: ReturnType<typeof fakeDatabase>) =>
    appWith(db).inject({
      method: 'POST',
      url: `/v1/clubs/${CLUB}/challenges/${CHALLENGE}/cancel`,
      headers: auth
    });

  it('lets an owner end a contest that should not have been opened', async () => {
    const db = fakeDatabase({ myRole: 'owner' });
    const response = await cancel(db);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'cancelled' });
    // Nothing is scored, so a cancelled contest never becomes a record.
    expect(db.sql()).not.toContain('club_challenge_results');
  });

  it('refuses a plain member', async () => {
    const db = fakeDatabase({ myRole: 'member' });
    const response = await cancel(db);

    expect(response.statusCode).toBe(403);
    expect(db.sql()).not.toContain('UPDATE club_challenges SET');
  });

  it('answers 409 for a contest that already finished', async () => {
    const db = fakeDatabase({ myRole: 'owner', cancelled: [], challengeStatus: 'finished' });
    const response = await cancel(db);

    expect(response.statusCode).toBe(409);
  });
});

describe('GET /v1/clubs/:clubId/challenges/:challengeId/standings', () => {
  const standings = (db: ReturnType<typeof fakeDatabase>) =>
    appWith(db).inject({
      method: 'GET',
      url: `/v1/clubs/${CLUB}/challenges/${CHALLENGE}/standings`,
      headers: auth
    });

  const participantRow = (
    accountId: string,
    displayName: string | null,
    extras: Record<string, unknown> = {}
  ) => ({
    account_id: accountId,
    display_name: displayName,
    cosmetic: displayName ? { avatarKey: 'loop-1' } : null,
    activity_visibility: 'private',
    blocked_either_way: false,
    stored_score: null,
    stored_rank: null,
    ...extras
  });

  it('shows nothing to a member who has not joined the contest', async () => {
    const db = fakeDatabase({ myRole: 'member', challengeCounts: { count: '3', joined: false } });
    const response = await standings(db);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ final: false, entries: [] });
    // Reading the other participants' scores means having published your own.
    expect(db.sql()).not.toContain('FROM club_challenge_participants participant');
  });

  it('ranks live scores over the challenge window for participants', async () => {
    const probe = fakeDatabase({
      myRole: 'member',
      challengeParticipants: [participantRow(ME, 'Maya')]
    });
    await standings(probe);
    const windowStart = probe.calls.find((call) => call.sql.includes('FROM activity_submissions'))
      ?.values?.[1] as Date;

    const db = fakeDatabase({
      myRole: 'member',
      challengeParticipants: [
        participantRow(ME, 'Maya'),
        participantRow(RAVI, 'Ravi'),
        participantRow(ANA, 'Ana')
      ],
      activities: [
        activityRow(RAVI, 200, windowStart),
        activityRow(ME, 90, windowStart),
        activityRow(ME, 30, windowStart)
      ]
    });
    const response = await standings(db);

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.final).toBe(false);
    expect(body.entries).toEqual([
      {
        profile: expect.objectContaining({ id: RAVI, displayName: 'Ravi' }),
        rank: 1,
        score: 200,
        isSelf: false
      },
      {
        profile: expect.objectContaining({ id: ME, displayName: 'Maya' }),
        rank: 2,
        score: 120,
        isSelf: true
      },
      {
        profile: expect.objectContaining({ id: ANA, displayName: 'Ana' }),
        rank: 3,
        score: 0,
        isSelf: false
      }
    ]);
  });

  it('reads the stored result of a finished contest rather than recomputing it', async () => {
    const db = fakeDatabase({
      myRole: 'member',
      challengeStatus: 'finished',
      challengeParticipants: [
        participantRow(ME, 'Maya', { stored_score: 120, stored_rank: 2 }),
        participantRow(RAVI, 'Ravi', { stored_score: 200, stored_rank: 1 })
      ]
    });
    const response = await standings(db);

    const body = response.json();
    expect(body.final).toBe(true);
    expect(body.entries.map((entry: { rank: number }) => entry.rank)).toEqual([1, 2]);
    expect(body.entries[0].score).toBe(200);
    // A finished window is history: nothing is scored again from activity.
    expect(db.sql()).not.toContain('FROM activity_submissions');
  });

  it('hides a blocked participant in either direction', async () => {
    const db = fakeDatabase({
      myRole: 'member',
      challengeParticipants: [
        participantRow(ME, 'Maya'),
        participantRow(RAVI, 'Ravi', { blocked_either_way: true })
      ]
    });
    const response = await standings(db);

    expect(
      response.json().entries.map((entry: { profile: { id: string } }) => entry.profile.id)
    ).toEqual([ME]);
    const activities = db.calls.find((call) => call.sql.includes('FROM activity_submissions'))!;
    expect(activities.values?.[0]).toEqual([ME]);
  });

  it('never reads route, location, pace, or distance for a standing', async () => {
    const db = fakeDatabase({
      myRole: 'member',
      challengeParticipants: [participantRow(ME, 'Maya')]
    });
    await standings(db);

    const sql = db.sql();
    for (const forbidden of ['route', 'geom', 'latitude', 'longitude', 'distance_meters'])
      expect(sql).not.toContain(forbidden);
  });
});

describe('GET /v1/clubs/:clubId/challenges', () => {
  it('lists the club contests with a count and the reader own state', async () => {
    const db = fakeDatabase({
      myRole: 'member',
      challenge: [
        {
          id: CHALLENGE,
          club_id: CLUB,
          mode: 'active_days',
          length_days: 14,
          status: 'active',
          period_start: '2026-08-31',
          period_end: '2026-09-14',
          rule_version: 1,
          created_at: new Date('2026-08-31T04:00:00.000Z'),
          participant_count: '5',
          joined: true
        }
      ]
    });
    const response = await appWith(db).inject({
      method: 'GET',
      url: `/v1/clubs/${CLUB}/challenges`,
      headers: auth
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual([
      expect.objectContaining({
        id: CHALLENGE,
        mode: 'active_days',
        lengthDays: 14,
        status: 'active',
        participantCount: 5,
        joined: true
      })
    ]);
    // A count, never a list: who else is in it is the standings' business.
    expect(JSON.stringify(response.json())).not.toContain('accountId');
  });

  it('answers 404 to a non-member', async () => {
    const db = fakeDatabase({ myRole: undefined });
    const response = await appWith(db).inject({
      method: 'GET',
      url: `/v1/clubs/${CLUB}/challenges`,
      headers: auth
    });

    expect(response.statusCode).toBe(404);
    expect(db.sql()).not.toContain('FROM club_challenges challenge');
  });
});
