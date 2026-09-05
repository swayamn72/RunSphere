import { describe, expect, it, vi } from 'vitest';
import type { Database } from '@runsphere/db';
import { closeCompetition, processCompetitions } from './competitions.js';

const COMPETITION = 'competition-1';
const ME = 'account-me';
const RAVI = 'account-ravi';
const ANA = 'account-ana';

const rule = {
  dailyCapMinutes: 240,
  minMinutesPerActiveDay: 1,
  lengthDays: [7, 14, 30],
  modes: ['active_minutes', 'active_days']
};

const competition = (overrides: Record<string, unknown> = {}) => ({
  id: COMPETITION,
  mode: 'active_minutes' as const,
  status: 'open' as const,
  period_start: '2026-09-07',
  period_end: '2026-09-14',
  dispute_period_hours: 48,
  rule_version: 1,
  closed_at: null,
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
  /** `[]` makes a status claim find nothing, as a concurrent sweep would. */
  claimed?: Record<string, unknown>[];
}

const fakeDatabase = (stubs: Stubs = {}) => {
  const statements: { sql: string; values: readonly unknown[] }[] = [];
  const respond = (sql: string) => {
    if (sql.includes("kind = 'competition'"))
      return { rows: stubs.ruleRows ?? [{ definition: rule }] };
    if (sql.includes('FROM competitions')) return { rows: stubs.due ?? [] };
    if (sql.includes('FROM competition_enrollments enrollment'))
      return { rows: stubs.participants ?? [] };
    if (sql.includes('FROM activity_submissions')) return { rows: stubs.activities ?? [] };
    if (sql.includes('UPDATE competitions SET'))
      return { rows: stubs.claimed ?? [{ id: COMPETITION }] };
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
        .filter((statement) => statement.sql.includes('INSERT INTO competition_results'))
        .map((statement) => statement.values),
    updates: () =>
      statements
        .filter((statement) => statement.sql.includes('UPDATE competitions SET'))
        .map((statement) => statement.sql),
    db(): Database {
      return this as unknown as Database;
    }
  };
};

describe('closing a competition', () => {
  it('scores every enrolled participant over the announced window', async () => {
    const database = fakeDatabase({
      participants: [{ account_id: ME }, { account_id: RAVI }, { account_id: ANA }],
      activities: [
        activity(RAVI, 200, '2026-09-08T05:00:00.000Z'),
        activity(ME, 200, '2026-09-09T05:00:00.000Z'),
        activity(ANA, 45, '2026-09-10T05:00:00.000Z')
      ]
    });

    await expect(closeCompetition(database.db(), competition())).resolves.toBe(true);
    // Equal scores share a rank and the next rank skips.
    expect(database.results()).toEqual([
      [COMPETITION, ME, 200, 1],
      [COMPETITION, RAVI, 200, 1],
      [COMPETITION, ANA, 45, 3]
    ]);
  });

  it('marks the competition closed in the same transaction as the result', async () => {
    const database = fakeDatabase({ participants: [{ account_id: ME }] });
    await closeCompetition(database.db(), competition());

    const order = database.statements.map((statement) => statement.sql);
    const claim = order.findIndex((sql) => sql.includes("status = 'closed'"));
    const insert = order.findIndex((sql) => sql.includes('INSERT INTO competition_results'));
    expect(claim).toBeGreaterThanOrEqual(0);
    expect(insert).toBeGreaterThan(claim);
    expect(order).toContain('BEGIN');
    expect(order).toContain('COMMIT');
  });

  it('writes nothing when another sweep already claimed it', async () => {
    const database = fakeDatabase({ participants: [{ account_id: ME }], claimed: [] });
    await closeCompetition(database.db(), competition());

    expect(database.results()).toEqual([]);
    expect(database.sql()).not.toContain('INSERT INTO notification_inbox');
  });

  it('scores only participants who are still entered and still live', async () => {
    const database = fakeDatabase({ participants: [{ account_id: ME }] });
    await closeCompetition(database.db(), competition());

    const lookup = database.statements.find((statement) =>
      statement.sql.includes('FROM competition_enrollments enrollment')
    )!;
    expect(lookup.sql).toContain('enrollment.withdrawn_at IS NULL');
    expect(lookup.sql).toContain('account.deleted_at IS NULL');
  });

  it('closes an empty competition without inventing participants', async () => {
    const database = fakeDatabase({ participants: [] });

    await expect(closeCompetition(database.db(), competition())).resolves.toBe(true);
    expect(database.results()).toEqual([]);
    expect(database.sql()).not.toContain('FROM activity_submissions');
  });

  it('scores under the rule version the competition was announced with', async () => {
    const database = fakeDatabase({ participants: [{ account_id: ME }] });
    await closeCompetition(database.db(), competition({ rule_version: 4 }));

    const lookup = database.statements.find((statement) =>
      statement.sql.includes("kind = 'competition'")
    )!;
    expect(lookup.values).toEqual([4]);
    expect(lookup.sql).not.toContain('superseded_at');
  });

  it('leaves the competition open when its rule can no longer be read', async () => {
    const database = fakeDatabase({ ruleRows: [], participants: [{ account_id: ME }] });

    await expect(closeCompetition(database.db(), competition())).resolves.toBe(false);
    expect(database.sql()).not.toContain('UPDATE competitions SET');
  });

  it('tells participants it closed and says the result is provisional', async () => {
    const database = fakeDatabase({
      participants: [{ account_id: ME }],
      activities: [activity(ME, 90, '2026-09-08T05:00:00.000Z')]
    });
    await closeCompetition(database.db(), competition());

    const notification = database.statements.find((statement) =>
      statement.sql.includes('INSERT INTO notification_inbox')
    )!;
    expect(notification.sql).toContain('provisional until the dispute period ends');
    // No score and no rank ride along, so a push payload cannot leak one.
    expect(JSON.stringify(notification.values)).not.toContain('90');
  });
});

describe('the competition sweep', () => {
  it('opens an announced competition once its window starts', async () => {
    const database = fakeDatabase({ due: [competition({ status: 'published' })] });

    await expect(
      processCompetitions(database.db(), new Date('2026-09-07T06:00:00.000Z'))
    ).resolves.toBe(1);
    expect(database.updates().some((sql) => sql.includes("status = 'open'"))).toBe(true);
    // Opening scores nothing.
    expect(database.results()).toEqual([]);
  });

  it('leaves an announced competition alone before its window starts', async () => {
    const database = fakeDatabase({ due: [competition({ status: 'published' })] });

    await expect(
      processCompetitions(database.db(), new Date('2026-09-01T06:00:00.000Z'))
    ).resolves.toBe(0);
    expect(database.updates()).toEqual([]);
  });

  it('finalizes a closed competition once the dispute period elapses, rescoring nothing', async () => {
    const database = fakeDatabase({
      due: [competition({ status: 'closed', closed_at: new Date('2026-09-14T00:00:00.000Z') })]
    });

    await expect(
      processCompetitions(database.db(), new Date('2026-09-16T01:00:00.000Z'))
    ).resolves.toBe(1);
    expect(database.updates().some((sql) => sql.includes("status = 'finalized'"))).toBe(true);
    expect(database.sql()).not.toContain('INSERT INTO competition_results');
  });

  it('reads only competitions whose state the clock can still move', async () => {
    const database = fakeDatabase();
    await processCompetitions(database.db());

    expect(database.statements[0]!.sql).toContain("status IN ('published', 'open', 'closed')");
  });
});
