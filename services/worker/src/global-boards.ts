import { withTransaction, type Database } from '@runsphere/db';
import {
  SHARING_SUSPENDED_KINDS,
  cappedWeeklyActiveMinutes,
  competitionRanking,
  divisionFor,
  kolkataDate,
  parseGlobalBoardRule,
  rankedOnGlobalBoard,
  weeklyPeriodStart,
  type GlobalBoardRule,
  type ScoredActivity
} from '@runsphere/domain';

/**
 * Global board materialization (Phase 3, milestone 3.5).
 *
 * Every score on the board is derived here from server-derived validated
 * activity — the client never reports a total and the API never computes one.
 * The job is a recompute rather than an increment, which makes it idempotent
 * (safe on every poll) and self-healing: a late validation, a corrected
 * activity, or a withdrawn opt-in all land correctly on the next pass.
 *
 * Only the open week and the week just closed are recomputed. Validation is
 * asynchronous, so a Sunday-evening walk can be validated on Monday and
 * belongs to the week it happened in; older weeks are history and are never
 * rewritten (ADR-0006).
 */

interface ActivityRow {
  account_id: string;
  active_duration_seconds: number;
  processed_at: Date;
}

const WEEK_MILLIS = 7 * 86_400_000;

/**
 * The published rule, or `undefined` when the global board is not enabled on
 * this deployment — in which case nothing is computed rather than computed
 * under a guess.
 */
export const loadGlobalBoardRule = async (
  db: Database
): Promise<{ version: number; rule: GlobalBoardRule } | undefined> => {
  const result = await db.query<{ version: number; definition: unknown }>(
    `SELECT version, definition FROM rule_versions
     WHERE kind = 'global_board' AND superseded_at IS NULL
     ORDER BY version DESC LIMIT 1`
  );
  const row = result.rows[0];
  if (!row) return undefined;
  return { version: row.version, rule: parseGlobalBoardRule(row.definition) };
};

/**
 * Recompute one week of the board from scratch.
 *
 * Membership of the board is the live opt-in and nothing else: an account that
 * revoked it is gone from the next recompute, which is what "separately
 * revocable" has to mean in practice (ADR-0007). An account with no qualifying
 * score is simply absent rather than listed against a zero.
 */
export const recomputeGlobalBoard = async (
  db: Database,
  periodStart: string,
  published: { version: number; rule: GlobalBoardRule }
): Promise<number> => {
  const weekStart = new Date(`${periodStart}T00:00:00.000Z`);
  const weekEnd = new Date(weekStart.getTime() + WEEK_MILLIS);

  // A sharing suspension takes an account off the board it had already
  // joined, not merely off the ones it has not. Recomputing from scratch is
  // what makes that possible: the next pass simply leaves them out.
  const optedIn = await db.query<{ account_id: string }>(
    `SELECT optin.account_id
     FROM leaderboard_opt_ins optin
     JOIN accounts account ON account.id = optin.account_id AND account.deleted_at IS NULL
     WHERE optin.scope = 'global' AND optin.revoked_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM sanctions suspension
         WHERE suspension.account_id = optin.account_id
           AND suspension.kind = ANY($1::text[])
           AND suspension.revoked_at IS NULL
           AND (suspension.expires_at IS NULL OR suspension.expires_at > now()))
     ORDER BY optin.account_id`,
    [[...SHARING_SUSPENDED_KINDS]]
  );
  const accountIds = optedIn.rows.map((row) => row.account_id);
  if (!accountIds.length) {
    await db.query('DELETE FROM global_board_entries WHERE period_start = $1::date', [periodStart]);
    return 0;
  }

  const activities = await db.query<ActivityRow>(
    `SELECT submission.account_id, output.active_duration_seconds, submission.processed_at
     FROM activity_submissions submission
     JOIN activity_validation_outputs output ON output.activity_id = submission.id
     WHERE submission.account_id = ANY($1::uuid[])
       AND submission.status = 'derived'
       AND submission.deleted_at IS NULL
       AND submission.processed_at >= $2
       AND submission.processed_at < $3`,
    [accountIds, weekStart, weekEnd]
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

  // How many earlier Kolkata weeks each account was active in. This is the
  // whole input to the division band: a count of weeks, never a score, a pace,
  // or a place.
  const history = await db.query<{ account_id: string; prior_weeks: string }>(
    `SELECT submission.account_id,
       count(DISTINCT date_trunc('week', submission.processed_at AT TIME ZONE 'Asia/Kolkata'))::text
         AS prior_weeks
     FROM activity_submissions submission
     WHERE submission.account_id = ANY($1::uuid[])
       AND submission.status = 'derived'
       AND submission.deleted_at IS NULL
       AND submission.processed_at < $2
     GROUP BY submission.account_id`,
    [accountIds, weekStart]
  );
  const priorWeeks = new Map(
    history.rows.map((row) => [row.account_id, Number(row.prior_weeks)] as const)
  );

  const qualified = accountIds
    .map((accountId) => ({
      accountId,
      score: cappedWeeklyActiveMinutes(
        byAccount.get(accountId) ?? [],
        weekStart,
        published.rule.dailyCapMinutes
      ),
      division: divisionFor(priorWeeks.get(accountId) ?? 0, published.rule)
    }))
    .filter((entry) => rankedOnGlobalBoard(entry.score, published.rule));

  // Ranked within the division, so a newcomer's week is never measured against
  // an established account's. Equal scores share a rank; the account id only
  // orders the list, and is never a tiebreak anyone is shown.
  const byDivision = new Map<string, typeof qualified>();
  for (const entry of qualified) {
    const bucket = byDivision.get(entry.division) ?? [];
    bucket.push(entry);
    byDivision.set(entry.division, bucket);
  }
  const ranked: { accountId: string; division: string; score: number; rank: number }[] = [];
  for (const [division, bucket] of byDivision) {
    const ordered = [...bucket].sort(
      (left, right) => right.score - left.score || left.accountId.localeCompare(right.accountId)
    );
    const ranks = competitionRanking(ordered.map((entry) => entry.score));
    ordered.forEach((entry, index) => {
      ranked.push({
        accountId: entry.accountId,
        division,
        score: entry.score,
        rank: ranks[index]!
      });
    });
  }

  await withTransaction(db, async (client) => {
    // Replace rather than merge, so a revoked opt-in, a deleted activity, or a
    // deleted account cannot leave a stale row on the board.
    await client.query('DELETE FROM global_board_entries WHERE period_start = $1::date', [
      periodStart
    ]);
    for (const entry of ranked) {
      await client.query(
        `INSERT INTO global_board_entries (period_start, account_id, division, score, rank,
           rule_version)
         VALUES ($1::date, $2, $3, $4, $5, $6)`,
        [periodStart, entry.accountId, entry.division, entry.score, entry.rank, published.version]
      );
    }
  });
  return ranked.length;
};

/** Recompute the open week and the week just closed. */
export const processGlobalBoards = async (
  db: Database,
  now: Date = new Date()
): Promise<number> => {
  const published = await loadGlobalBoardRule(db);
  if (!published) return 0;
  const openWeek = weeklyPeriodStart(now);
  const previousWeek = new Date(openWeek.getTime() - WEEK_MILLIS);

  let written = 0;
  for (const week of [openWeek, previousWeek]) {
    written += await recomputeGlobalBoard(db, kolkataDate(week), published);
  }
  return written;
};
