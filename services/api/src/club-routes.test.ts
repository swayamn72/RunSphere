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
}

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
    expect(statements[0]).toBe('BEGIN');
    expect(statements.some((sql) => sql.includes("VALUES ($1, $2, 'owner')"))).toBe(true);
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
