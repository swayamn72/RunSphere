import { describe, expect, it, vi } from 'vitest';
import type { Database } from '@runsphere/db';
import { loadClubRelayRule, processClubRelays, recomputeRelay } from './club-relays.js';

const RELAY = 'relay-1';
const CLUB = 'club-1';
const ME = 'account-me';
const RAVI = 'account-ravi';

const rule = {
  dailyCapMinutes: 240,
  memberWeeklyCapMinutes: 600,
  minTargetUnits: 60,
  maxTargetUnits: 20_000
};

const activity = (accountId: string, minutes: number, processedAt: string) => ({
  account_id: accountId,
  active_duration_seconds: minutes * 60,
  processed_at: new Date(processedAt)
});

interface Stubs {
  ruleRows?: Record<string, unknown>[];
  relays?: Record<string, unknown>[];
  activities?: Record<string, unknown>[];
}

const fakeDatabase = (stubs: Stubs = {}) => {
  const statements: { sql: string; values: readonly unknown[] }[] = [];
  const respond = (sql: string) => {
    if (sql.includes("kind = 'club'"))
      return { rows: stubs.ruleRows ?? [{ version: 1, definition: rule }] };
    if (sql.includes('FROM club_relays relay')) return { rows: stubs.relays ?? [] };
    if (sql.includes('FROM club_memberships membership')) return { rows: stubs.activities ?? [] };
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
    db(): Database {
      return this as unknown as Database;
    }
  };
};

const relayRow = { id: RELAY, club_id: CLUB, period_start: '2026-08-31' };

describe('the published relay rule', () => {
  it('is absent when the deployment has not published one', async () => {
    await expect(loadClubRelayRule(fakeDatabase({ ruleRows: [] }).db())).resolves.toBeUndefined();
  });

  it('reads the highest live version', async () => {
    const database = fakeDatabase();
    await expect(loadClubRelayRule(database.db())).resolves.toEqual({ version: 1, rule });
    expect(database.statements[0]!.sql).toContain('superseded_at IS NULL');
    expect(database.statements[0]!.sql).toContain('ORDER BY version DESC');
  });
});

describe('recomputing one relay', () => {
  it('sums capped validated minutes per member from server-derived activity only', async () => {
    const database = fakeDatabase({
      activities: [
        activity(ME, 30, '2026-08-31T05:00:00.000Z'),
        activity(ME, 45, '2026-09-01T05:00:00.000Z'),
        activity(RAVI, 20, '2026-09-02T05:00:00.000Z')
      ]
    });

    await expect(recomputeRelay(database.db(), relayRow, rule)).resolves.toBe(2);

    const select = database.statements.find((statement) =>
      statement.sql.includes('FROM club_memberships membership')
    )!;
    expect(select.sql).toContain("submission.status = 'derived'");
    expect(select.sql).toContain('submission.deleted_at IS NULL');
    expect(select.sql).toContain('membership.left_at IS NULL');

    const inserts = database.statements.filter((statement) =>
      statement.sql.includes('INSERT INTO club_relay_contributions')
    );
    expect(inserts.map((insert) => insert.values)).toEqual([
      [RELAY, ME, 75],
      [RELAY, RAVI, 20]
    ]);
  });

  it('replaces the previous rows rather than adding to them', async () => {
    const database = fakeDatabase({ activities: [activity(ME, 10, '2026-08-31T05:00:00.000Z')] });

    await recomputeRelay(database.db(), relayRow, rule);

    const statements = database.statements.map((statement) => statement.sql);
    const deleteAt = statements.findIndex((sql) =>
      sql.includes('DELETE FROM club_relay_contributions')
    );
    const insertAt = statements.findIndex((sql) =>
      sql.includes('INSERT INTO club_relay_contributions')
    );
    expect(deleteAt).toBeGreaterThan(-1);
    expect(deleteAt).toBeLessThan(insertAt);
    // The replacement is one transaction, so a club total is never observed
    // mid-recompute with the old rows gone and the new ones not yet written.
    expect(statements.indexOf('BEGIN')).toBeLessThan(deleteAt);
    expect(statements.indexOf('COMMIT')).toBeGreaterThan(insertAt);
  });

  it('caps one very active member so a club target cannot be carried alone', async () => {
    const database = fakeDatabase({
      activities: [
        activity(ME, 400, '2026-08-31T05:00:00.000Z'),
        activity(ME, 400, '2026-09-01T05:00:00.000Z'),
        activity(ME, 400, '2026-09-02T05:00:00.000Z'),
        activity(ME, 400, '2026-09-03T05:00:00.000Z')
      ]
    });

    await recomputeRelay(database.db(), relayRow, rule);

    const insert = database.statements.find((statement) =>
      statement.sql.includes('INSERT INTO club_relay_contributions')
    )!;
    expect(insert.values[2]).toBe(rule.memberWeeklyCapMinutes);
  });

  it('writes no row for a member who contributed nothing', async () => {
    const database = fakeDatabase({ activities: [] });

    await expect(recomputeRelay(database.db(), relayRow, rule)).resolves.toBe(0);
    expect(database.sql()).toContain('DELETE FROM club_relay_contributions');
    expect(database.sql()).not.toContain('INSERT INTO club_relay_contributions');
  });
});

describe('the relay sweep', () => {
  it('does nothing when no relay rule is published', async () => {
    const database = fakeDatabase({ ruleRows: [] });
    await expect(processClubRelays(database.db())).resolves.toBe(0);
    expect(database.sql()).not.toContain('FROM club_relays relay');
  });

  it('recomputes the open week and the week just closed, and no older ones', async () => {
    const database = fakeDatabase({ relays: [relayRow] });

    await expect(
      processClubRelays(database.db(), new Date('2026-09-04T09:00:00.000Z'))
    ).resolves.toBe(1);

    const select = database.statements.find((statement) =>
      statement.sql.includes('FROM club_relays relay')
    )!;
    // Asia/Kolkata Mondays either side of 2026-09-04.
    expect(select.values).toEqual(['2026-08-31', '2026-08-24']);
    expect(select.sql).toContain('relay.period_start IN ($1::date, $2::date)');
  });

  it('skips relays in an archived club', async () => {
    const database = fakeDatabase({ relays: [] });
    await processClubRelays(database.db(), new Date('2026-09-04T09:00:00.000Z'));

    const select = database.statements.find((statement) =>
      statement.sql.includes('FROM club_relays relay')
    )!;
    expect(select.sql).toContain('club.archived_at IS NULL');
  });
});
