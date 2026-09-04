import { withTransaction, type Database } from '@runsphere/db';
import {
  kolkataDate,
  parseClubRelayRule,
  relayMemberUnits,
  weeklyPeriodStart,
  type ClubRelayRule,
  type ScoredActivity
} from '@runsphere/domain';

/**
 * Club relay aggregation (Phase 3, milestone 3.2).
 *
 * Contributions are derived here and nowhere else: the client never reports a
 * total, and the API never computes one. Each member's units come from
 * server-derived validated activity, capped per day and again per week by the
 * published rule, so one very active member cannot carry a club target
 * (ADR-0005, ADR-0006).
 *
 * The job is a recompute rather than an increment. That makes it idempotent —
 * safe to run every poll — and self-healing: a late validation, a corrected
 * activity, or a deleted one all land correctly on the next pass, which an
 * accumulating counter could never do.
 */

interface RelayRow {
  id: string;
  club_id: string;
  period_start: Date | string;
}

interface ActivityRow {
  account_id: string;
  active_duration_seconds: number;
  processed_at: Date;
}

const asDateString = (value: Date | string): string =>
  typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);

/**
 * The published relay rule, or `undefined` when relays are not enabled on this
 * deployment — in which case nothing is scored rather than scored by a guess.
 */
export const loadClubRelayRule = async (
  db: Database
): Promise<{ version: number; rule: ClubRelayRule } | undefined> => {
  const result = await db.query<{ version: number; definition: unknown }>(
    `SELECT version, definition FROM rule_versions
     WHERE kind = 'club' AND superseded_at IS NULL
     ORDER BY version DESC LIMIT 1`
  );
  const row = result.rows[0];
  if (!row) return undefined;
  return { version: row.version, rule: parseClubRelayRule(row.definition) };
};

/**
 * Recompute one relay from scratch.
 *
 * Only *currently active* members are counted. Someone who left mid-week stops
 * contributing from that moment on, which is the same rule access follows:
 * leaving a club ends the relationship rather than retaining a claim on it.
 * Their existing row is removed by the delete-and-reinsert, so the club total
 * never keeps units from a member who is gone.
 */
export const recomputeRelay = async (
  db: Database,
  relay: RelayRow,
  rule: ClubRelayRule
): Promise<number> => {
  const periodStart = asDateString(relay.period_start);
  const weekStart = weeklyPeriodStart(new Date(`${periodStart}T00:00:00.000Z`));
  const weekEnd = new Date(weekStart.getTime() + 7 * 86_400_000);

  const activities = await db.query<ActivityRow>(
    `SELECT submission.account_id, output.active_duration_seconds, submission.processed_at
     FROM club_memberships membership
     JOIN activity_submissions submission ON submission.account_id = membership.account_id
     JOIN activity_validation_outputs output ON output.activity_id = submission.id
     WHERE membership.club_id = $1 AND membership.left_at IS NULL
       AND submission.status = 'derived' AND submission.deleted_at IS NULL
       AND submission.processed_at >= $2 AND submission.processed_at < $3
     ORDER BY submission.account_id, submission.processed_at`,
    [relay.club_id, weekStart, weekEnd]
  );

  const byAccount = new Map<string, ScoredActivity[]>();
  for (const row of activities.rows) {
    const bucket = byAccount.get(row.account_id) ?? [];
    bucket.push({
      activeDurationSeconds: row.active_duration_seconds,
      endedAt: row.processed_at
    });
    byAccount.set(row.account_id, bucket);
  }

  const contributions = [...byAccount.entries()]
    .map(([accountId, scored]) => ({
      accountId,
      units: relayMemberUnits(scored, weekStart, rule)
    }))
    .filter((contribution) => contribution.units > 0);

  await withTransaction(db, async (client) => {
    // Replace rather than merge, so a member who left or whose activity was
    // withdrawn cannot leave stale units behind in the club total.
    await client.query('DELETE FROM club_relay_contributions WHERE relay_id = $1', [relay.id]);
    for (const contribution of contributions) {
      await client.query(
        `INSERT INTO club_relay_contributions (relay_id, account_id, units)
         VALUES ($1, $2, $3)`,
        [relay.id, contribution.accountId, contribution.units]
      );
    }
  });
  return contributions.length;
};

/**
 * Recompute the open week plus the week just closed.
 *
 * The closed week is included for a bounded settling period because activity
 * validation is asynchronous: a Sunday-evening walk can be validated on Monday,
 * and it belongs to the week it happened in. Older weeks are left alone — they
 * are history, and rewriting them would break the immutability every other
 * period record keeps (ADR-0006).
 */
export const processClubRelays = async (db: Database, now: Date = new Date()): Promise<number> => {
  const published = await loadClubRelayRule(db);
  if (!published) return 0;
  const openWeek = weeklyPeriodStart(now);
  const previousWeek = new Date(openWeek.getTime() - 7 * 86_400_000);

  const relays = await db.query<RelayRow>(
    `SELECT relay.id, relay.club_id, relay.period_start
     FROM club_relays relay
     JOIN clubs club ON club.id = relay.club_id
     WHERE club.archived_at IS NULL
       AND relay.period_start IN ($1::date, $2::date)
     ORDER BY relay.period_start DESC
     LIMIT 500`,
    [kolkataDate(openWeek), kolkataDate(previousWeek)]
  );

  let recomputed = 0;
  for (const relay of relays.rows) {
    await recomputeRelay(db, relay, published.rule);
    recomputed += 1;
  }
  return recomputed;
};
