import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '@runsphere/db';
import { buildApp } from './app.js';
import { createAccessToken } from './auth.js';

const SECRET = 'competition-routes-test-secret';
const ME = '00000000-0000-4000-8000-00000000000a';
const RAVI = '00000000-0000-4000-8000-00000000000b';
const COMPETITION = '00000000-0000-4000-8000-0000000000f1';

const competitionRow = (overrides: Record<string, unknown> = {}) => ({
  id: COMPETITION,
  title: 'September steady week',
  mode: 'active_minutes',
  status: 'published',
  period_start: '2026-09-07',
  period_end: '2026-09-14',
  min_prior_active_weeks: 0,
  rewards: 'A cosmetic badge',
  dispute_period_hours: 48,
  rule_version: 1,
  created_at: new Date('2026-09-01T04:00:00.000Z'),
  closed_at: null,
  ...overrides
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

interface Stubs {
  roles?: { role: string }[];
  competitions?: Record<string, unknown>[];
  /** The single-competition lookup; `[]` means no such competition. */
  competition?: Record<string, unknown>[];
  counts?: { count: string; enrolled: boolean };
  priorWeeks?: string;
  participants?: Record<string, unknown>[];
  activities?: Record<string, unknown>[];
  rule?: Record<string, unknown>[];
  changed?: Record<string, unknown>[];
}

const fakeDatabase = (stubs: Stubs = {}) => {
  const calls: { sql: string; values: readonly unknown[] | undefined }[] = [];
  const respond = (sql: string) => {
    if (sql.includes('FROM staff_role_assignments')) return { rows: stubs.roles ?? [] };
    if (sql.includes("kind = 'competition'"))
      return {
        rows: stubs.rule ?? [
          {
            version: 1,
            definition: {
              dailyCapMinutes: 240,
              minMinutesPerActiveDay: 1,
              lengthDays: [7, 14, 30],
              modes: ['active_minutes', 'active_days']
            }
          }
        ]
      };
    if (sql.includes('count(DISTINCT date_trunc'))
      return { rows: [{ weeks: stubs.priorWeeks ?? '10' }] };
    if (sql.includes('FROM competitions competition')) return { rows: stubs.competitions ?? [] };
    if (sql.includes('INSERT INTO competitions') || sql.includes('UPDATE competitions SET'))
      return { rows: stubs.changed ?? [competitionRow()] };
    if (sql.includes('FROM competitions WHERE id'))
      return { rows: stubs.competition ?? [competitionRow()] };
    if (sql.includes('FROM competition_enrollments enrollment'))
      return { rows: stubs.participants ?? [] };
    if (sql.includes('FROM competition_enrollments WHERE competition_id'))
      return {
        rows: [
          {
            participant_count: stubs.counts?.count ?? '3',
            enrolled: stubs.counts?.enrolled ?? true
          }
        ]
      };
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

describe('GET /v1/competitions', () => {
  it('lists announced competitions with the reader own state and eligibility', async () => {
    const db = fakeDatabase({
      competitions: [competitionRow({ participant_count: '12', enrolled: true })],
      priorWeeks: '6'
    });
    const response = await appWith(db).inject({
      method: 'GET',
      url: '/v1/competitions',
      headers: auth
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual([
      expect.objectContaining({
        id: COMPETITION,
        title: 'September steady week',
        status: 'published',
        rewards: 'A cosmetic badge',
        disputePeriodHours: 48,
        participantCount: 12,
        enrolled: true,
        eligible: true
      })
    ]);
    // A draft has not been announced, so it is never in a member's list.
    const list = db.calls.find((call) => call.sql.includes('FROM competitions competition'))!;
    expect(list.sql).toContain("competition.status <> 'draft'");
  });

  it('reports ineligibility rather than hiding a competition the reader cannot enter', async () => {
    const db = fakeDatabase({
      competitions: [competitionRow({ min_prior_active_weeks: 8, participant_count: '2' })],
      priorWeeks: '3'
    });
    const response = await appWith(db).inject({
      method: 'GET',
      url: '/v1/competitions',
      headers: auth
    });

    const entry = response.json().data[0];
    expect(entry.eligible).toBe(false);
    expect(entry.minPriorActiveWeeks).toBe(8);
  });

  it('publishes the dispute deadline once the window has closed', async () => {
    const db = fakeDatabase({
      competitions: [
        competitionRow({
          status: 'closed',
          closed_at: new Date('2026-09-14T00:00:00.000Z'),
          participant_count: '4'
        })
      ]
    });
    const response = await appWith(db).inject({
      method: 'GET',
      url: '/v1/competitions',
      headers: auth
    });

    expect(response.json().data[0].disputeEndsAt).toBe('2026-09-16T00:00:00.000Z');
  });
});

describe('PUT /v1/competitions/:competitionId/enrollment', () => {
  const enroll = (db: ReturnType<typeof fakeDatabase>, enrolled: boolean) =>
    appWith(db).inject({
      method: 'PUT',
      url: `/v1/competitions/${COMPETITION}/enrollment`,
      headers: auth,
      payload: { enrolled }
    });

  it('enters the reader and reopens a place they withdrew from', async () => {
    const db = fakeDatabase({ counts: { count: '4', enrolled: true } });
    const response = await enroll(db, true);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ enrolled: true, participantCount: 4 });
    const insert = db.calls.find((call) =>
      call.sql.includes('INSERT INTO competition_enrollments')
    )!;
    expect(insert.sql).toContain('DO UPDATE SET withdrawn_at = NULL');
  });

  it('records a withdrawal rather than deleting the entry', async () => {
    const db = fakeDatabase({ counts: { count: '3', enrolled: false } });
    const response = await enroll(db, false);

    expect(response.statusCode).toBe(200);
    expect(response.json().enrolled).toBe(false);
    expect(db.sql()).toContain('UPDATE competition_enrollments SET withdrawn_at = now()');
    expect(db.sql()).not.toContain('DELETE FROM competition_enrollments');
  });

  it('refuses an entry that misses the published eligibility band, and says which', async () => {
    const db = fakeDatabase({
      competition: [competitionRow({ min_prior_active_weeks: 8 })],
      priorWeeks: '2'
    });
    const response = await enroll(db, true);

    expect(response.statusCode).toBe(403);
    expect(response.json().message).toContain('8 earlier active weeks');
    expect(db.sql()).not.toContain('INSERT INTO competition_enrollments');
  });

  it('lets an ineligible account withdraw, because leaving is never gated', async () => {
    const db = fakeDatabase({
      competition: [competitionRow({ min_prior_active_weeks: 8 })],
      priorWeeks: '2',
      counts: { count: '1', enrolled: false }
    });
    const response = await enroll(db, false);

    expect(response.statusCode).toBe(200);
    expect(db.sql()).toContain('UPDATE competition_enrollments SET withdrawn_at = now()');
  });

  it('refuses an entry once the window has closed', async () => {
    const db = fakeDatabase({ competition: [competitionRow({ status: 'closed' })] });
    const response = await enroll(db, true);

    expect(response.statusCode).toBe(409);
    expect(db.sql()).not.toContain('INSERT INTO competition_enrollments');
  });

  it('does not admit a draft exists', async () => {
    const db = fakeDatabase({ competition: [competitionRow({ status: 'draft' })] });
    const response = await enroll(db, true);

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ message: 'Competition not found' });
  });
});

describe('GET /v1/competitions/:competitionId/standings', () => {
  const standings = (db: ReturnType<typeof fakeDatabase>) =>
    appWith(db).inject({
      method: 'GET',
      url: `/v1/competitions/${COMPETITION}/standings`,
      headers: auth
    });

  it('shows nothing to somebody who has not entered', async () => {
    const db = fakeDatabase({ counts: { count: '5', enrolled: false } });
    const response = await standings(db);

    expect(response.statusCode).toBe(200);
    expect(response.json().entries).toEqual([]);
    // Reading the other participants' scores means having entered yourself.
    expect(db.sql()).not.toContain('FROM competition_enrollments enrollment');
  });

  it('ranks live scores while the window is open', async () => {
    const db = fakeDatabase({
      competition: [competitionRow({ status: 'open' })],
      participants: [participantRow(ME, 'Maya'), participantRow(RAVI, 'Ravi')],
      activities: [
        {
          account_id: RAVI,
          active_duration_seconds: 200 * 60,
          processed_at: new Date('2026-09-08T05:00:00.000Z')
        },
        {
          account_id: ME,
          active_duration_seconds: 120 * 60,
          processed_at: new Date('2026-09-09T05:00:00.000Z')
        }
      ]
    });
    const response = await standings(db);

    const body = response.json();
    expect(body.live).toBe(true);
    expect(body.provisional).toBe(false);
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
      }
    ]);
  });

  it('reads the stored result once closed and says it is still provisional', async () => {
    const db = fakeDatabase({
      competition: [
        competitionRow({ status: 'closed', closed_at: new Date('2026-09-14T00:00:00.000Z') })
      ],
      participants: [
        participantRow(ME, 'Maya', { stored_score: 120, stored_rank: 2 }),
        participantRow(RAVI, 'Ravi', { stored_score: 200, stored_rank: 1 })
      ]
    });
    const response = await standings(db);

    const body = response.json();
    expect(body.live).toBe(false);
    expect(body.provisional).toBe(true);
    expect(body.entries.map((entry: { rank: number }) => entry.rank)).toEqual([1, 2]);
    // A closed window is history: nothing is scored again from activity. The
    // only activity read left is the eligibility history behind the summary,
    // which never joins the validation outputs a score is derived from.
    expect(db.sql()).not.toContain('activity_validation_outputs');
  });

  it('stops calling a finalized result provisional', async () => {
    const db = fakeDatabase({
      competition: [
        competitionRow({ status: 'finalized', closed_at: new Date('2026-09-14T00:00:00.000Z') })
      ],
      participants: [participantRow(ME, 'Maya', { stored_score: 120, stored_rank: 1 })]
    });

    expect((await standings(db)).json().provisional).toBe(false);
  });

  it('hides a blocked participant in either direction', async () => {
    const db = fakeDatabase({
      competition: [competitionRow({ status: 'open' })],
      participants: [
        participantRow(ME, 'Maya'),
        participantRow(RAVI, 'Ravi', { blocked_either_way: true })
      ]
    });
    const response = await standings(db);

    expect(
      response.json().entries.map((entry: { profile: { id: string } }) => entry.profile.id)
    ).toEqual([ME]);
  });

  it('never reads route, location, pace, or distance', async () => {
    const db = fakeDatabase({
      competition: [competitionRow({ status: 'open' })],
      participants: [participantRow(ME, 'Maya')]
    });
    await standings(db);

    const sql = db.sql();
    for (const forbidden of ['route', 'geom', 'latitude', 'longitude', 'distance_meters'])
      expect(sql).not.toContain(forbidden);
  });
});

describe('POST /v1/staff/competitions', () => {
  const schedule = (db: ReturnType<typeof fakeDatabase>, payload: Record<string, unknown>) =>
    appWith(db).inject({
      method: 'POST',
      url: '/v1/staff/competitions',
      headers: auth,
      payload
    });

  it('creates a draft, because announcing is a second deliberate act', async () => {
    const db = fakeDatabase({ roles: [{ role: 'season_operator' }] });
    const response = await schedule(db, {
      title: 'September steady week',
      mode: 'active_minutes',
      periodStart: '2026-09-07',
      lengthDays: 7,
      rewards: 'A cosmetic badge'
    });

    expect(response.statusCode).toBe(201);
    const insert = db.calls.find((call) => call.sql.includes('INSERT INTO competitions'))!;
    // The default status is `draft`, so nothing is announced by creating it.
    expect(insert.sql).not.toContain("'published'");
    expect(insert.sql).toContain('$3::date + $4');
    expect(db.sql()).toContain('staff_audit_events');
  });

  it('refuses an account with no operator role', async () => {
    const db = fakeDatabase({ roles: [{ role: 'support' }] });
    const response = await schedule(db, {
      title: 'Unauthorized event',
      mode: 'active_minutes',
      periodStart: '2026-09-07',
      lengthDays: 7
    });

    expect(response.statusCode).toBe(403);
    expect(db.sql()).not.toContain('INSERT INTO competitions');
  });

  it('answers 422 for a length the published rule does not allow', async () => {
    const db = fakeDatabase({ roles: [{ role: 'admin' }] });
    const response = await schedule(db, {
      title: 'Two-day sprint',
      mode: 'active_minutes',
      periodStart: '2026-09-07',
      lengthDays: 2
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().message).toContain('7, 14, 30');
  });

  it('answers 422 when no competition rule is published', async () => {
    const db = fakeDatabase({ roles: [{ role: 'admin' }], rule: [] });
    const response = await schedule(db, {
      title: 'Nothing to score by',
      mode: 'active_minutes',
      periodStart: '2026-09-07',
      lengthDays: 7
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({ message: 'No competition rule is published' });
  });
});

describe('POST /v1/staff/competitions/:competitionId/status', () => {
  const change = (db: ReturnType<typeof fakeDatabase>, publish: boolean) =>
    appWith(db).inject({
      method: 'POST',
      url: `/v1/staff/competitions/${COMPETITION}/status`,
      headers: auth,
      payload: { publish }
    });

  it('announces a draft', async () => {
    const db = fakeDatabase({ roles: [{ role: 'season_operator' }] });
    const response = await change(db, true);

    expect(response.statusCode).toBe(200);
    const update = db.calls.find((call) => call.sql.includes('UPDATE competitions SET'))!;
    expect(update.sql).toContain("status = 'published'");
    // Publishing is one-way: only a draft can be announced.
    expect(update.sql).toContain("status = 'draft'");
  });

  it('cancels an announced competition without scoring it', async () => {
    const db = fakeDatabase({
      roles: [{ role: 'admin' }],
      changed: [competitionRow({ status: 'cancelled' })]
    });
    const response = await change(db, false);

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('cancelled');
    expect(db.sql()).not.toContain('competition_results');
  });

  it('answers 409 when the competition is past the state for that change', async () => {
    const db = fakeDatabase({ roles: [{ role: 'admin' }], changed: [] });
    const response = await change(db, true);

    expect(response.statusCode).toBe(409);
  });

  it('answers 404 when there is no such competition at all', async () => {
    const db = fakeDatabase({ roles: [{ role: 'admin' }], changed: [], competition: [] });
    const response = await change(db, true);

    expect(response.statusCode).toBe(404);
  });

  it('refuses a member without an operator role', async () => {
    const db = fakeDatabase({ roles: [] });
    const response = await change(db, true);

    expect(response.statusCode).toBe(403);
    expect(db.sql()).not.toContain('UPDATE competitions SET');
  });
});
