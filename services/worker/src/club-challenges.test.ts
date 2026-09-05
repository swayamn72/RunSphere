import { describe, expect, it, vi } from 'vitest';
import type { Database } from '@runsphere/db';
import { finishClubChallenge, processClubChallenges } from './club-challenges.js';

const CHALLENGE = 'challenge-1';
const CLUB = 'club-1';
const ME = 'account-me';
const RAVI = 'account-ravi';
const ANA = 'account-ana';

const rule = {
  dailyCapMinutes: 240,
  minMinutesPerActiveDay: 1,
  lengthDays: [7, 14],
  modes: ['active_minutes', 'active_days']
};

const challenge = (overrides: Record<string, unknown> = {}) => ({
  id: CHALLENGE,
  club_id: CLUB,
  mode: 'active_minutes' as const,
  length_days: 7,
  period_start: '2026-08-31',
  rule_version: 1,
  ...overrides
});

const activity = (accountId: string, minutes: number, processedAt: string) => ({
  account_id: accountId,
  active_duration_seconds: minutes * 60,
  processed_at: new Date(processedAt)
});

interface Stubs {
  ruleRows?: Record<string, unknown>[];
  due?: Record<string, unknown>[];
  participants?: { account_id: string }[];
  activities?: Record<string, unknown>[];
  /** `[]` makes the status claim find nothing, as a concurrent sweep would. */
  claimed?: Record<string, unknown>[];
}

const fakeDatabase = (stubs: Stubs = {}) => {
  const statements: { sql: string; values: readonly unknown[] }[] = [];
  const respond = (sql: string) => {
    if (sql.includes("kind = 'club_challenge'"))
      return { rows: stubs.ruleRows ?? [{ definition: rule }] };
    if (sql.includes('FROM club_challenges challenge')) return { rows: stubs.due ?? [] };
    if (sql.includes('FROM club_challenge_participants participant'))
      return { rows: stubs.participants ?? [] };
    if (sql.includes('FROM activity_submissions')) return { rows: stubs.activities ?? [] };
    if (sql.includes('UPDATE club_challenges SET'))
      return { rows: stubs.claimed ?? [{ id: CHALLENGE }] };
    return { rows: [] };
  };
  const record = (sql: string, values: readonly unknown[] = []) => {
    statements.push({ sql, values });
    return respond(sql);
  };
  const query = vi.fn(async (sql: string, values?: readonly unknown[]) => record(sql, values));
  const clientQuery = vi.fn(async (sql: string, values?: readonly unknown[]) =>
    record(sql, values)
  );
  const client = { query: clientQuery, release: vi.fn() };
  return {
    statements,
    query,
    clientQuery,
    connect: vi.fn(async () => client),
    end: vi.fn(async () => undefined),
    sql: () => statements.map((statement) => statement.sql).join('\n'),
    results: () =>
      statements
        .filter((statement) => statement.sql.includes('INSERT INTO club_challenge_results'))
        .map((statement) => statement.values),
    db(): Database {
      return this as unknown as Database;
    }
  };
};

describe('finishing one club challenge', () => {
  it('scores every participant over the same window and stores shared ranks', async () => {
    const database = fakeDatabase({
      participants: [{ account_id: ME }, { account_id: RAVI }, { account_id: ANA }],
      activities: [
        activity(RAVI, 200, '2026-08-31T05:00:00.000Z'),
        activity(ME, 200, '2026-09-01T05:00:00.000Z'),
        activity(ANA, 30, '2026-09-02T05:00:00.000Z')
      ]
    });

    await expect(finishClubChallenge(database.db(), challenge())).resolves.toBe(true);

    // Equal scores share a rank and the next rank skips: a tie is never broken
    // on pace, distance, or timing.
    expect(database.results()).toEqual([
      [CHALLENGE, ME, 200, 1],
      [CHALLENGE, RAVI, 200, 1],
      [CHALLENGE, ANA, 30, 3]
    ]);
  });

  it('marks the challenge finished in the same transaction as the result', async () => {
    const database = fakeDatabase({ participants: [{ account_id: ME }] });
    await finishClubChallenge(database.db(), challenge());

    const order = database.statements.map((statement) => statement.sql);
    const claim = order.findIndex((sql) => sql.includes('UPDATE club_challenges SET'));
    const insert = order.findIndex((sql) => sql.includes('INSERT INTO club_challenge_results'));
    expect(claim).toBeGreaterThanOrEqual(0);
    expect(insert).toBeGreaterThan(claim);
    expect(order).toContain('BEGIN');
    expect(order).toContain('COMMIT');
  });

  it('writes nothing when another sweep already claimed the challenge', async () => {
    const database = fakeDatabase({ participants: [{ account_id: ME }], claimed: [] });
    await finishClubChallenge(database.db(), challenge());

    expect(database.results()).toEqual([]);
    expect(database.sql()).not.toContain('INSERT INTO notification_inbox');
  });

  it('counts only participants who are still in the contest and the club', async () => {
    const database = fakeDatabase({ participants: [{ account_id: ME }] });
    await finishClubChallenge(database.db(), challenge());

    const lookup = database.statements.find((statement) =>
      statement.sql.includes('FROM club_challenge_participants participant')
    )!;
    expect(lookup.sql).toContain('participant.left_at IS NULL');
    expect(lookup.sql).toContain('membership.left_at IS NULL');
    expect(lookup.sql).toContain('account.deleted_at IS NULL');
  });

  it('finishes an empty contest without inventing participants', async () => {
    const database = fakeDatabase({ participants: [] });

    await expect(finishClubChallenge(database.db(), challenge())).resolves.toBe(true);
    expect(database.results()).toEqual([]);
    // Nobody to score means no activity is read at all.
    expect(database.sql()).not.toContain('FROM activity_submissions');
  });

  it('scores under the rule version the challenge was opened with', async () => {
    const database = fakeDatabase({ participants: [{ account_id: ME }] });
    await finishClubChallenge(database.db(), challenge({ rule_version: 3 }));

    const ruleLookup = database.statements.find((statement) =>
      statement.sql.includes("kind = 'club_challenge'")
    )!;
    expect(ruleLookup.values).toEqual([3]);
    expect(ruleLookup.sql).not.toContain('superseded_at');
  });

  it('leaves the challenge active when its rule can no longer be read', async () => {
    const database = fakeDatabase({ ruleRows: [], participants: [{ account_id: ME }] });

    await expect(finishClubChallenge(database.db(), challenge())).resolves.toBe(false);
    expect(database.sql()).not.toContain('UPDATE club_challenges SET');
  });

  it('refuses a mode the recorded rule does not score', async () => {
    const database = fakeDatabase({ participants: [{ account_id: ME }] });

    await expect(
      finishClubChallenge(database.db(), challenge({ mode: 'quest_completion' }))
    ).resolves.toBe(false);
    expect(database.sql()).not.toContain('INSERT INTO club_challenge_results');
  });

  it('tells each participant it finished without putting a score in the message', async () => {
    const database = fakeDatabase({
      participants: [{ account_id: ME }, { account_id: RAVI }],
      activities: [activity(ME, 90, '2026-09-01T05:00:00.000Z')]
    });
    await finishClubChallenge(database.db(), challenge());

    const notifications = database.statements.filter((statement) =>
      statement.sql.includes('INSERT INTO notification_inbox')
    );
    expect(notifications).toHaveLength(2);
    expect(notifications[0]!.sql).toContain("'challenge_finished'");
    expect(JSON.stringify(notifications[0]!.values)).not.toContain('90');
    expect(String(notifications[0]!.values[1])).toBe(
      `runsphere://clubs/${CLUB}/challenges/${CHALLENGE}`
    );
  });
});

describe('the due sweep', () => {
  it('takes only closed windows of live clubs', async () => {
    const database = fakeDatabase();
    await processClubChallenges(database.db());

    const sweep = database.statements[0]!;
    expect(sweep.sql).toContain("challenge.status = 'active'");
    expect(sweep.sql).toContain('club.archived_at IS NULL');
    expect(sweep.sql).toContain("(now() AT TIME ZONE 'Asia/Kolkata')::date");
  });

  it('reports how many it finished', async () => {
    const database = fakeDatabase({ due: [challenge()], participants: [{ account_id: ME }] });

    await expect(processClubChallenges(database.db())).resolves.toBe(1);
  });

  it('counts nothing when a challenge could not be scored', async () => {
    const database = fakeDatabase({ due: [challenge()], ruleRows: [] });

    await expect(processClubChallenges(database.db())).resolves.toBe(0);
  });
});
