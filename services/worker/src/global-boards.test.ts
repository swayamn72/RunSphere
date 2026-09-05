import { describe, expect, it, vi } from 'vitest';
import type { Database } from '@runsphere/db';
import { loadGlobalBoardRule, processGlobalBoards, recomputeGlobalBoard } from './global-boards.js';

const ME = 'account-me';
const RAVI = 'account-ravi';
const ANA = 'account-ana';

const definition = {
  dailyCapMinutes: 240,
  pageSize: 50,
  minScore: 1,
  divisions: [
    { key: 'newcomer', maxPriorActiveWeeks: 0 },
    { key: 'rising', maxPriorActiveWeeks: 3 },
    { key: 'established' }
  ]
};

const activity = (accountId: string, minutes: number, processedAt: string) => ({
  account_id: accountId,
  active_duration_seconds: minutes * 60,
  processed_at: new Date(processedAt)
});

interface Stubs {
  ruleRows?: Record<string, unknown>[];
  optedIn?: { account_id: string }[];
  activities?: Record<string, unknown>[];
  history?: { account_id: string; prior_weeks: string }[];
}

const fakeDatabase = (stubs: Stubs = {}) => {
  const statements: { sql: string; values: readonly unknown[] }[] = [];
  const respond = (sql: string) => {
    if (sql.includes("kind = 'global_board'"))
      return { rows: stubs.ruleRows ?? [{ version: 1, definition }] };
    if (sql.includes('FROM leaderboard_opt_ins optin')) return { rows: stubs.optedIn ?? [] };
    if (sql.includes('count(DISTINCT date_trunc')) return { rows: stubs.history ?? [] };
    if (sql.includes('FROM activity_submissions')) return { rows: stubs.activities ?? [] };
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
    inserts: () =>
      statements
        .filter((statement) => statement.sql.includes('INSERT INTO global_board_entries'))
        .map((statement) => statement.values),
    db(): Database {
      return this as unknown as Database;
    }
  };
};

const published = { version: 1, rule: { ...definition } };

describe('the published global board rule', () => {
  it('is absent when the deployment has not published one', async () => {
    await expect(loadGlobalBoardRule(fakeDatabase({ ruleRows: [] }).db())).resolves.toBeUndefined();
  });

  it('computes nothing at all without a published rule', async () => {
    const database = fakeDatabase({ ruleRows: [] });
    await expect(processGlobalBoards(database.db())).resolves.toBe(0);
    expect(database.sql()).not.toContain('global_board_entries');
  });
});

describe('recomputing one week', () => {
  it('ranks within a division and shares a rank on a tie', async () => {
    const database = fakeDatabase({
      optedIn: [{ account_id: ME }, { account_id: RAVI }, { account_id: ANA }],
      activities: [
        activity(ME, 200, '2026-08-31T05:00:00.000Z'),
        activity(RAVI, 200, '2026-09-01T05:00:00.000Z'),
        activity(ANA, 30, '2026-09-01T06:00:00.000Z')
      ],
      // Everyone lands in the same band, so all three are ranked together.
      history: [
        { account_id: ME, prior_weeks: '10' },
        { account_id: RAVI, prior_weeks: '10' },
        { account_id: ANA, prior_weeks: '10' }
      ]
    });

    await expect(recomputeGlobalBoard(database.db(), '2026-08-31', published)).resolves.toBe(3);
    expect(database.inserts()).toEqual([
      ['2026-08-31', ME, 'established', 200, 1, 1],
      ['2026-08-31', RAVI, 'established', 200, 1, 1],
      ['2026-08-31', ANA, 'established', 30, 3, 1]
    ]);
  });

  it('ranks a newcomer against newcomers rather than against everyone', async () => {
    const database = fakeDatabase({
      optedIn: [{ account_id: ME }, { account_id: RAVI }],
      activities: [
        activity(ME, 30, '2026-08-31T05:00:00.000Z'),
        activity(RAVI, 500, '2026-08-31T05:00:00.000Z')
      ],
      history: [{ account_id: RAVI, prior_weeks: '40' }]
    });

    await recomputeGlobalBoard(database.db(), '2026-08-31', published);
    // No history row at all means a first week: the newcomer band, and a rank
    // of 1 in it despite the far larger score alongside them.
    expect(database.inserts()).toEqual([
      ['2026-08-31', ME, 'newcomer', 30, 1, 1],
      ['2026-08-31', RAVI, 'established', 240, 1, 1]
    ]);
  });

  it('caps a day before it is scored, so one long day cannot carry a week', async () => {
    const database = fakeDatabase({
      optedIn: [{ account_id: ME }],
      activities: [activity(ME, 600, '2026-08-31T05:00:00.000Z')],
      history: [{ account_id: ME, prior_weeks: '9' }]
    });

    await recomputeGlobalBoard(database.db(), '2026-08-31', published);
    expect(database.inserts()[0]?.[3]).toBe(240);
  });

  it('leaves an account that did not move off the board rather than listing a zero', async () => {
    const database = fakeDatabase({
      optedIn: [{ account_id: ME }, { account_id: RAVI }],
      activities: [activity(RAVI, 45, '2026-08-31T05:00:00.000Z')],
      history: []
    });

    await expect(recomputeGlobalBoard(database.db(), '2026-08-31', published)).resolves.toBe(1);
    expect(database.inserts().map((values) => values[1])).toEqual([RAVI]);
  });

  it('replaces the week rather than merging into it', async () => {
    const database = fakeDatabase({
      optedIn: [{ account_id: ME }],
      activities: [activity(ME, 60, '2026-08-31T05:00:00.000Z')]
    });

    await recomputeGlobalBoard(database.db(), '2026-08-31', published);
    const order = database.statements.map((statement) => statement.sql);
    const remove = order.findIndex((sql) => sql.includes('DELETE FROM global_board_entries'));
    const insert = order.findIndex((sql) => sql.includes('INSERT INTO global_board_entries'));
    expect(remove).toBeGreaterThanOrEqual(0);
    expect(insert).toBeGreaterThan(remove);
    expect(order).toContain('BEGIN');
    expect(order).toContain('COMMIT');
  });

  it('clears the week when nobody is opted in any more', async () => {
    const database = fakeDatabase({ optedIn: [] });

    await expect(recomputeGlobalBoard(database.db(), '2026-08-31', published)).resolves.toBe(0);
    expect(database.sql()).toContain('DELETE FROM global_board_entries');
    expect(database.inserts()).toEqual([]);
    // Nobody to score means no activity is read at all.
    expect(database.sql()).not.toContain('FROM activity_submissions');
  });

  it('reads only live opt-ins of live accounts', async () => {
    const database = fakeDatabase({ optedIn: [{ account_id: ME }] });
    await recomputeGlobalBoard(database.db(), '2026-08-31', published);

    const lookup = database.statements.find((statement) =>
      statement.sql.includes('FROM leaderboard_opt_ins optin')
    )!;
    expect(lookup.sql).toContain("optin.scope = 'global'");
    expect(lookup.sql).toContain('optin.revoked_at IS NULL');
    expect(lookup.sql).toContain('account.deleted_at IS NULL');
  });

  it('derives a division from weeks of history, never from a score', async () => {
    const database = fakeDatabase({ optedIn: [{ account_id: ME }] });
    await recomputeGlobalBoard(database.db(), '2026-08-31', published);

    const history = database.statements.find((statement) =>
      statement.sql.includes('count(DISTINCT date_trunc')
    )!;
    expect(history.sql).toContain("AT TIME ZONE 'Asia/Kolkata'");
    expect(history.sql).not.toContain('active_duration_seconds');
    expect(history.sql).not.toContain('distance');
  });
});

describe('the weekly sweep', () => {
  it('recomputes the open week and the week just closed, and no older one', async () => {
    const database = fakeDatabase({ optedIn: [] });
    await processGlobalBoards(database.db(), new Date('2026-09-03T10:00:00.000Z'));

    const weeks = database.statements
      .filter((statement) => statement.sql.includes('DELETE FROM global_board_entries'))
      .map((statement) => statement.values[0]);
    expect(weeks).toEqual(['2026-08-31', '2026-08-24']);
  });
});

describe('a suspended account leaves the board', () => {
  it('is filtered out of the recompute rather than only barred from joining', async () => {
    const database = fakeDatabase({ optedIn: [{ account_id: ME }] });
    await recomputeGlobalBoard(database.db(), '2026-08-31', published);

    const lookup = database.statements.find((statement) =>
      statement.sql.includes('FROM leaderboard_opt_ins optin')
    )!;
    // A suspension that only stopped new opt-ins would leave the account on
    // every board it had already joined; the recompute simply omits them.
    expect(lookup.sql).toContain('FROM sanctions suspension');
    expect(lookup.sql).toContain('suspension.revoked_at IS NULL');
    expect(lookup.sql).toContain('suspension.expires_at > now()');
    expect(lookup.values[0]).toEqual(['social_suspension', 'account_suspension']);
  });
});
