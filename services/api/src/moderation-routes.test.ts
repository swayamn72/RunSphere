import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '@runsphere/db';
import { buildApp } from './app.js';
import { createAccessToken } from './auth.js';

const SECRET = 'moderation-routes-test-secret';
const ME = '00000000-0000-4000-8000-00000000000a';
const RAVI = '00000000-0000-4000-8000-00000000000b';
const CLUB = '00000000-0000-4000-8000-0000000000c1';
const REPORT = '00000000-0000-4000-8000-0000000000e1';
const SANCTION = '00000000-0000-4000-8000-0000000000e2';
const APPEAL = '00000000-0000-4000-8000-0000000000e3';

const sanctionRow = (overrides: Record<string, unknown> = {}) => ({
  id: SANCTION,
  kind: 'social_suspension',
  reason: 'harassment',
  statement: 'Your club name repeated a slur. It has been removed.',
  issued_at: new Date('2026-09-01T10:00:00.000Z'),
  expires_at: new Date('2099-01-01T00:00:00.000Z'),
  revoked_at: null,
  appeal_id: null,
  appeal_status: null,
  appeal_created_at: null,
  appeal_decided_at: null,
  appeal_decision_note: null,
  ...overrides
});

interface Stubs {
  roles?: { role: string }[];
  sanctions?: Record<string, unknown>[];
  reports?: Record<string, unknown>[];
  report?: Record<string, unknown>[];
  appeals?: Record<string, unknown>[];
  appeal?: Record<string, unknown>[];
  /** `[]` makes a claim find nothing, as a concurrent decision would. */
  claimed?: Record<string, unknown>[];
  sanctionExists?: boolean;
}

const fakeDatabase = (stubs: Stubs = {}) => {
  const calls: { sql: string; values: readonly unknown[] | undefined }[] = [];
  const respond = (sql: string) => {
    if (sql.includes('FROM staff_role_assignments')) return { rows: stubs.roles ?? [] };
    if (sql.includes('FROM sanctions sanction')) return { rows: stubs.sanctions ?? [] };
    if (sql.includes('FROM reports report')) return { rows: stubs.reports ?? [] };
    if (sql.includes('FROM reports WHERE id'))
      return {
        rows: stubs.report ?? [
          {
            id: REPORT,
            subject_type: 'account',
            subject_id: RAVI,
            reason: 'harassment',
            status: 'open'
          }
        ]
      };
    if (sql.includes('UPDATE reports SET status'))
      return { rows: stubs.claimed ?? [{ id: REPORT }] };
    if (sql.includes('FROM sanction_appeals appeal')) return { rows: stubs.appeals ?? [] };
    if (sql.includes('FROM sanction_appeals WHERE id'))
      return {
        rows: stubs.appeal ?? [{ id: APPEAL, sanction_id: SANCTION, status: 'open' }]
      };
    if (sql.includes('UPDATE sanction_appeals SET status'))
      return { rows: stubs.claimed ?? [{ account_id: RAVI }] };
    if (sql.includes('UPDATE sanctions SET revoked_at'))
      return { rows: stubs.claimed ?? [{ account_id: RAVI }] };
    if (sql.includes('SELECT id FROM sanctions WHERE id'))
      return { rows: stubs.sanctionExists === false ? [] : [{ id: SANCTION }] };
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

describe('POST /v1/reports', () => {
  const report = (db: ReturnType<typeof fakeDatabase>, payload: Record<string, unknown>) =>
    appWith(db).inject({ method: 'POST', url: '/v1/reports', headers: auth, payload });

  it('accepts a report about an account and promises no follow-up', async () => {
    const db = fakeDatabase();
    const response = await report(db, {
      subjectType: 'account',
      subjectId: RAVI,
      reason: 'harassment',
      note: 'Repeated messages after I asked them to stop.'
    });

    expect(response.statusCode).toBe(202);
    const body = response.json();
    expect(body.received).toBe(true);
    expect(body.message).toContain('will not send you an update');
    // The reporter learns nothing about the subject: no status, no outcome.
    expect(Object.keys(body).sort()).toEqual(['message', 'received']);
  });

  it('accepts a report about a club', async () => {
    const db = fakeDatabase();
    const response = await report(db, {
      subjectType: 'club',
      subjectId: CLUB,
      reason: 'hate_or_violence'
    });

    expect(response.statusCode).toBe(202);
    const insert = db.calls.find((call) => call.sql.includes('INSERT INTO reports'))!;
    expect(insert.values?.[1]).toBe('club');
  });

  it('works on a blocked account, which is the gap this closed', async () => {
    const db = fakeDatabase();
    const response = await report(db, {
      subjectType: 'account',
      subjectId: RAVI,
      reason: 'harassment'
    });

    expect(response.statusCode).toBe(202);
    // Blocking is never consulted: hiding somebody does not revoke your
    // ability to raise what they did.
    expect(db.sql()).not.toContain('FROM blocks');
  });

  it('folds a second report on the same subject into the first', async () => {
    const db = fakeDatabase();
    await report(db, { subjectType: 'account', subjectId: RAVI, reason: 'spam_or_scam' });

    const insert = db.calls.find((call) => call.sql.includes('INSERT INTO reports'))!;
    // Refusing would both disclose state and discourage a second attempt.
    expect(insert.sql).toContain('DO UPDATE SET');
  });

  it('refuses a report about yourself', async () => {
    const db = fakeDatabase();
    const response = await report(db, {
      subjectType: 'account',
      subjectId: ME,
      reason: 'harassment'
    });

    expect(response.statusCode).toBe(400);
    expect(db.sql()).not.toContain('INSERT INTO reports');
  });

  it('never records the reporter against the subject account', async () => {
    const db = fakeDatabase();
    await report(db, { subjectType: 'account', subjectId: RAVI, reason: 'harassment' });

    const audit = db.calls.find((call) => call.sql.includes('privacy_audit_events'))!;
    expect(audit.values?.[0]).toBe(ME);
    expect(JSON.stringify(audit.values)).not.toContain(RAVI);
  });
});

describe('GET /v1/account/sanctions', () => {
  it('shows an account its own sanctions, in force or not', async () => {
    const db = fakeDatabase({
      sanctions: [
        sanctionRow(),
        sanctionRow({
          id: 'expired',
          kind: 'warning',
          expires_at: null,
          revoked_at: new Date('2026-09-02T00:00:00.000Z')
        })
      ]
    });
    const response = await appWith(db).inject({
      method: 'GET',
      url: '/v1/account/sanctions',
      headers: auth
    });

    expect(response.statusCode).toBe(200);
    const [live, past] = response.json().data;
    expect(live).toMatchObject({
      kind: 'social_suspension',
      inForce: true,
      canAppeal: true,
      statement: 'Your club name repeated a slur. It has been removed.'
    });
    // A record that vanished when it ended could not be checked or answered.
    expect(past).toMatchObject({ inForce: false, canAppeal: false });
    const read = db.calls.find((call) => call.sql.includes('FROM sanctions sanction'))!;
    expect(read.values).toEqual([ME]);
  });

  it('reports an existing appeal alongside the sanction', async () => {
    const db = fakeDatabase({
      sanctions: [
        sanctionRow({
          appeal_id: APPEAL,
          appeal_status: 'upheld',
          appeal_created_at: new Date('2026-09-02T00:00:00.000Z'),
          appeal_decided_at: new Date('2026-09-03T00:00:00.000Z'),
          appeal_decision_note: 'The name was still in use after the warning.'
        })
      ]
    });
    const response = await appWith(db).inject({
      method: 'GET',
      url: '/v1/account/sanctions',
      headers: auth
    });

    const sanction = response.json().data[0];
    expect(sanction.appeal).toMatchObject({
      status: 'upheld',
      decisionNote: 'The name was still in use after the warning.'
    });
    // One appeal per sanction, so an answered one cannot be reopened.
    expect(sanction.canAppeal).toBe(false);
  });
});

describe('POST /v1/sanctions/:sanctionId/appeal', () => {
  const appeal = (db: ReturnType<typeof fakeDatabase>) =>
    appWith(db).inject({
      method: 'POST',
      url: `/v1/sanctions/${SANCTION}/appeal`,
      headers: auth,
      payload: { statement: 'The club name is my surname, not a slur.' }
    });

  it('records one appeal in the account own words', async () => {
    const db = fakeDatabase({ sanctions: [sanctionRow()] });
    const response = await appeal(db);

    expect(response.statusCode).toBe(201);
    const insert = db.calls.find((call) => call.sql.includes('INSERT INTO sanction_appeals'))!;
    expect(insert.values?.[2]).toBe('The club name is my surname, not a slur.');
    expect(insert.sql).toContain('ON CONFLICT (sanction_id) DO NOTHING');
  });

  it('does not admit somebody else sanction exists', async () => {
    const db = fakeDatabase({ sanctions: [] });
    const response = await appeal(db);

    expect(response.statusCode).toBe(404);
    expect(db.sql()).not.toContain('INSERT INTO sanction_appeals');
  });

  it('refuses a second appeal', async () => {
    const db = fakeDatabase({
      sanctions: [
        sanctionRow({
          appeal_id: APPEAL,
          appeal_status: 'open',
          appeal_created_at: new Date('2026-09-02T00:00:00.000Z')
        })
      ]
    });

    expect((await appeal(db)).statusCode).toBe(409);
  });

  it('refuses an appeal against a sanction that no longer applies', async () => {
    const db = fakeDatabase({
      sanctions: [sanctionRow({ revoked_at: new Date('2026-09-02T00:00:00.000Z') })]
    });

    expect((await appeal(db)).statusCode).toBe(409);
  });
});

describe('GET /v1/staff/reports', () => {
  const queue = (db: ReturnType<typeof fakeDatabase>) =>
    appWith(db).inject({ method: 'GET', url: '/v1/staff/reports', headers: auth });

  it('shows the oldest open report first, with the subject published name', async () => {
    const db = fakeDatabase({
      roles: [{ role: 'moderator' }],
      reports: [
        {
          id: REPORT,
          subject_type: 'account',
          subject_id: RAVI,
          subject_name: 'Ravi',
          reason: 'harassment',
          note: 'Repeated messages.',
          created_at: new Date('2026-09-01T10:00:00.000Z'),
          open_report_count: '3'
        }
      ]
    });
    const response = await queue(db);

    expect(response.statusCode).toBe(200);
    expect(response.json().data[0]).toMatchObject({
      subjectName: 'Ravi',
      reason: 'harassment',
      openReportCount: 3
    });
    const read = db.calls.find((call) => call.sql.includes('FROM reports report'))!;
    expect(read.sql).toContain('ORDER BY report.created_at');
    expect(db.sql()).toContain('staff_audit_events');
  });

  it('refuses an account without a moderator role', async () => {
    const db = fakeDatabase({ roles: [{ role: 'season_operator' }] });

    expect((await queue(db)).statusCode).toBe(403);
    expect(db.sql()).not.toContain('FROM reports report');
  });

  it('never reads an activity, a location, or a route', async () => {
    const db = fakeDatabase({ roles: [{ role: 'admin' }] });
    await queue(db);

    const sql = db.sql();
    for (const forbidden of ['activity_submissions', 'route', 'geom', 'latitude', 'longitude'])
      expect(sql).not.toContain(forbidden);
  });
});

describe('POST /v1/staff/reports/:reportId/resolve', () => {
  const resolve = (db: ReturnType<typeof fakeDatabase>, payload: Record<string, unknown>) =>
    appWith(db).inject({
      method: 'POST',
      url: `/v1/staff/reports/${REPORT}/resolve`,
      headers: auth,
      payload
    });

  it('dismisses a report with a staff-only note', async () => {
    const db = fakeDatabase({ roles: [{ role: 'moderator' }] });
    const response = await resolve(db, {
      action: 'dismiss',
      resolutionNote: 'Name is a common surname.'
    });

    expect(response.statusCode).toBe(204);
    expect(db.sql()).not.toContain('INSERT INTO sanctions');
    // Nothing is sent to the subject when nothing happened to them.
    expect(db.sql()).not.toContain('INSERT INTO notification_inbox');
  });

  it('issues a sanction the account will be shown, and tells it where to read', async () => {
    const db = fakeDatabase({ roles: [{ role: 'admin' }] });
    const response = await resolve(db, {
      action: 'sanction',
      sanctionKind: 'social_suspension',
      statement: 'Your display name impersonated another member.',
      durationHours: 72
    });

    expect(response.statusCode).toBe(204);
    const insert = db.calls.find((call) => call.sql.includes('INSERT INTO sanctions'))!;
    expect(insert.values?.[0]).toBe(RAVI);
    expect(insert.values?.[3]).toBe('Your display name impersonated another member.');
    expect(insert.values?.[4]).toBeInstanceOf(Date);
    const notice = db.calls.find((call) => call.sql.includes('notification_inbox'))!;
    // The notice carries no reporter and no reason code.
    expect(notice.sql).toContain('runsphere://account/sanctions');
    expect(JSON.stringify(notice.values)).not.toContain('impersonated');
  });

  it('refuses to sanction without a statement the account can read', async () => {
    const db = fakeDatabase({ roles: [{ role: 'admin' }] });
    const response = await resolve(db, {
      action: 'sanction',
      sanctionKind: 'warning'
    });

    expect(response.statusCode).toBe(422);
    expect(db.sql()).not.toContain('INSERT INTO sanctions');
  });

  it('refuses to sanction a club, which would punish every member', async () => {
    const db = fakeDatabase({
      roles: [{ role: 'admin' }],
      report: [
        { id: REPORT, subject_type: 'club', subject_id: CLUB, reason: 'other', status: 'open' }
      ]
    });
    const response = await resolve(db, {
      action: 'sanction',
      sanctionKind: 'social_suspension',
      statement: 'The club name is a slur.'
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().message).toContain('Only an account');
  });

  it('refuses an expiry on a warning, which does not expire', async () => {
    const db = fakeDatabase({ roles: [{ role: 'admin' }] });
    const response = await resolve(db, {
      action: 'sanction',
      sanctionKind: 'warning',
      statement: 'Please keep club names civil.',
      durationHours: 24
    });

    expect(response.statusCode).toBe(422);
  });

  it('answers 409 for a report somebody already resolved', async () => {
    const db = fakeDatabase({
      roles: [{ role: 'admin' }],
      report: [
        {
          id: REPORT,
          subject_type: 'account',
          subject_id: RAVI,
          reason: 'harassment',
          status: 'dismissed'
        }
      ]
    });

    expect((await resolve(db, { action: 'dismiss' })).statusCode).toBe(409);
  });

  it('refuses an account without a moderator role', async () => {
    const db = fakeDatabase({ roles: [] });

    expect((await resolve(db, { action: 'dismiss' })).statusCode).toBe(403);
    expect(db.sql()).not.toContain('UPDATE reports SET status');
  });
});

describe('POST /v1/staff/appeals/:appealId/decision', () => {
  const decide = (db: ReturnType<typeof fakeDatabase>, payload: Record<string, unknown>) =>
    appWith(db).inject({
      method: 'POST',
      url: `/v1/staff/appeals/${APPEAL}/decision`,
      headers: auth,
      payload
    });

  it('upholds a sanction without revoking it', async () => {
    const db = fakeDatabase({ roles: [{ role: 'moderator' }] });
    const response = await decide(db, {
      decision: 'upheld',
      decisionNote: 'The name was still in use after the warning.'
    });

    expect(response.statusCode).toBe(204);
    // "Upheld" is the sanction standing, so nothing is lifted.
    expect(db.sql()).not.toContain('UPDATE sanctions SET revoked_at');
  });

  it('revokes the sanction in the same transaction when it overturns one', async () => {
    const db = fakeDatabase({ roles: [{ role: 'admin' }] });
    const response = await decide(db, {
      decision: 'overturned',
      decisionNote: 'The name is the member surname.'
    });

    expect(response.statusCode).toBe(204);
    const statements = db.calls.map((call) => call.sql);
    const decision = statements.findIndex((sql) => sql.includes('UPDATE sanction_appeals SET'));
    const revoke = statements.findIndex((sql) => sql.includes('UPDATE sanctions SET revoked_at'));
    expect(revoke).toBeGreaterThan(decision);
    expect(statements).toContain('BEGIN');
    expect(statements).toContain('COMMIT');
  });

  it('tells the appellant a decision was made', async () => {
    const db = fakeDatabase({ roles: [{ role: 'admin' }] });
    await decide(db, { decision: 'overturned', decisionNote: 'Mistaken identity.' });

    const notice = db.calls.find((call) => call.sql.includes('notification_inbox'))!;
    expect(notice.values?.[0]).toBe(RAVI);
    expect(notice.sql).toContain('Your appeal has been decided');
  });

  it('answers 409 for an appeal somebody already decided', async () => {
    const db = fakeDatabase({
      roles: [{ role: 'admin' }],
      appeal: [{ id: APPEAL, sanction_id: SANCTION, status: 'upheld' }]
    });

    expect((await decide(db, { decision: 'overturned', decisionNote: 'Late.' })).statusCode).toBe(
      409
    );
  });

  it('requires a reason, because a decision without one is not an answer', async () => {
    const db = fakeDatabase({ roles: [{ role: 'admin' }] });

    expect((await decide(db, { decision: 'upheld', decisionNote: '' })).statusCode).toBe(400);
  });
});

describe('GET /v1/staff/accounts/:accountId/sanctions', () => {
  const history = (db: ReturnType<typeof fakeDatabase>) =>
    appWith(db).inject({
      method: 'GET',
      url: `/v1/staff/accounts/${RAVI}/sanctions`,
      headers: auth
    });

  it('shows a moderator what an account was told, and whether it still applies', async () => {
    const db = fakeDatabase({
      roles: [{ role: 'moderator' }],
      sanctions: [
        sanctionRow({ account_id: RAVI, revoked_reason: '' }),
        sanctionRow({
          id: 'past',
          account_id: RAVI,
          revoked_at: new Date('2026-09-02T00:00:00.000Z'),
          revoked_reason: 'expired'
        })
      ]
    });
    const response = await history(db);

    expect(response.statusCode).toBe(200);
    const [live, past] = response.json().data;
    expect(live).toMatchObject({ inForce: true, hasOpenAppeal: false, accountId: RAVI });
    expect(past).toMatchObject({ inForce: false, revokedReason: 'expired' });
  });

  it('flags an open appeal, so two staff do not answer the same thing differently', async () => {
    const db = fakeDatabase({
      roles: [{ role: 'admin' }],
      sanctions: [
        sanctionRow({
          account_id: RAVI,
          revoked_reason: '',
          appeal_id: APPEAL,
          appeal_status: 'open',
          appeal_created_at: new Date('2026-09-02T00:00:00.000Z')
        })
      ]
    });

    expect((await history(db)).json().data[0].hasOpenAppeal).toBe(true);
  });

  it('never returns who reported the account', async () => {
    const db = fakeDatabase({
      roles: [{ role: 'admin' }],
      sanctions: [sanctionRow({ account_id: RAVI, revoked_reason: '' })]
    });
    const response = await history(db);

    // Who reported somebody is not part of deciding whether to lift.
    expect(JSON.stringify(response.json())).not.toContain('report');
    const read = db.calls.find((call) => call.sql.includes('FROM sanctions sanction'))!;
    expect(read.sql).not.toContain('reports');
  });

  it('audits the read, because looking at somebody history is itself an act', async () => {
    const db = fakeDatabase({ roles: [{ role: 'moderator' }] });
    await history(db);

    const audit = db.calls.find((call) => call.sql.includes('staff_audit_events'))!;
    expect(audit.values?.[1]).toBe('moderation.sanctions.read');
  });

  it('refuses an account without a moderator role', async () => {
    const db = fakeDatabase({ roles: [{ role: 'campaign_manager' }] });

    expect((await history(db)).statusCode).toBe(403);
    expect(db.sql()).not.toContain('FROM sanctions sanction');
  });
});

describe('POST /v1/staff/sanctions/:sanctionId/lift', () => {
  const lift = (db: ReturnType<typeof fakeDatabase>, reason = 'Mistaken identity.') =>
    appWith(db).inject({
      method: 'POST',
      url: `/v1/staff/sanctions/${SANCTION}/lift`,
      headers: auth,
      payload: { reason }
    });

  it('ends a sanction early and keeps the reason with it', async () => {
    const db = fakeDatabase({ roles: [{ role: 'moderator' }] });
    const response = await lift(db);

    expect(response.statusCode).toBe(204);
    const update = db.calls.find((call) => call.sql.includes('UPDATE sanctions SET revoked_at'))!;
    expect(update.values).toEqual([SANCTION, 'Mistaken identity.']);
    // Revoked, never deleted: the record of what was done and undone is the point.
    expect(db.sql()).not.toContain('DELETE FROM sanctions');
  });

  it('tells the account in the same transaction', async () => {
    const db = fakeDatabase({ roles: [{ role: 'admin' }] });
    await lift(db);

    const statements = db.calls.map((call) => call.sql);
    const update = statements.findIndex((sql) => sql.includes('UPDATE sanctions SET revoked_at'));
    const notice = statements.findIndex((sql) => sql.includes('notification_inbox'));
    expect(notice).toBeGreaterThan(update);
    expect(statements).toContain('BEGIN');
    expect(statements).toContain('COMMIT');
    // The reason staff wrote is for the record, not for the notice.
    const inbox = db.calls.find((call) => call.sql.includes('notification_inbox'))!;
    expect(JSON.stringify(inbox.values)).not.toContain('Mistaken identity.');
  });

  it('requires a reason, because an unexplained lift is what an audit is for', async () => {
    const db = fakeDatabase({ roles: [{ role: 'admin' }] });
    const response = await appWith(db).inject({
      method: 'POST',
      url: `/v1/staff/sanctions/${SANCTION}/lift`,
      headers: auth,
      payload: { reason: '' }
    });

    expect(response.statusCode).toBe(400);
    expect(db.sql()).not.toContain('UPDATE sanctions SET revoked_at');
  });

  it('answers 409 for a sanction that already ended', async () => {
    const db = fakeDatabase({ roles: [{ role: 'admin' }], claimed: [] });

    expect((await lift(db)).statusCode).toBe(409);
  });

  it('answers 404 when there is no such sanction', async () => {
    const db = fakeDatabase({ roles: [{ role: 'admin' }], claimed: [], sanctionExists: false });

    expect((await lift(db)).statusCode).toBe(404);
  });

  it('refuses an account without a moderator role', async () => {
    const db = fakeDatabase({ roles: [] });

    expect((await lift(db)).statusCode).toBe(403);
    expect(db.sql()).not.toContain('UPDATE sanctions SET revoked_at');
  });
});
