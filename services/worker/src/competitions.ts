import { withTransaction, type Database } from '@runsphere/db';
import {
  challengeModeScore,
  challengeWindow,
  competitionRanking,
  competitionStatusDue,
  kolkataDateStart,
  parseChallengeRule,
  type ChallengeMode,
  type ChallengeRule,
  type CompetitionStatus,
  type ScoredActivity
} from '@runsphere/domain';

/**
 * Scheduled competition lifecycle (Phase 3, milestone 3.6).
 *
 * The clock, not a person, moves a competition through its states: an
 * announced event opens when its window starts, closes when the window ends,
 * and stops being provisional when the stated dispute period has elapsed. Each
 * transition is decided by a pure predicate in `@runsphere/domain`, so the
 * worker never invents a rule the tests do not also see.
 *
 * Scoring happens exactly once, in the transaction that marks the competition
 * closed, from server-derived validated activity only. The `status = 'open'`
 * claim is the idempotence: a failed pass leaves the competition open and the
 * next sweep tries again, and a scored competition is never selected twice.
 */

interface DueCompetitionRow {
  id: string;
  mode: ChallengeMode;
  status: CompetitionStatus;
  period_start: Date | string;
  period_end: Date | string;
  dispute_period_hours: number;
  rule_version: number;
  closed_at: Date | null;
}

interface ActivityRow {
  account_id: string;
  active_duration_seconds: number;
  processed_at: Date;
}

const asDateString = (value: Date | string): string =>
  typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);

const windowDays = (row: DueCompetitionRow): number =>
  Math.round(
    (kolkataDateStart(asDateString(row.period_end)).getTime() -
      kolkataDateStart(asDateString(row.period_start)).getTime()) /
      86_400_000
  );

/**
 * The rule version recorded on the competition, not the newest one. An event
 * is always scored under the rules it was announced with, even if a newer rule
 * has been published since.
 */
const loadRule = async (db: Database, version: number): Promise<ChallengeRule | undefined> => {
  const result = await db.query<{ definition: unknown }>(
    `SELECT definition FROM rule_versions WHERE kind = 'competition' AND version = $1`,
    [version]
  );
  const row = result.rows[0];
  return row ? parseChallengeRule(row.definition) : undefined;
};

/**
 * Score every enrolled participant and close the competition.
 *
 * Only accounts that are *still enrolled and still live* are scored:
 * withdrawing ends the claim to a place in the result, which is the same rule
 * every other contest follows.
 */
export const closeCompetition = async (
  db: Database,
  competition: DueCompetitionRow
): Promise<boolean> => {
  const rule = await loadRule(db, competition.rule_version);
  // A rule that can no longer be read is left for a human: the competition
  // stays open rather than closing with invented scores.
  if (!rule) return false;
  if (!rule.modes.includes(competition.mode)) return false;

  const window = challengeWindow(asDateString(competition.period_start), windowDays(competition));
  const participants = await db.query<{ account_id: string }>(
    `SELECT enrollment.account_id
     FROM competition_enrollments enrollment
     JOIN accounts account ON account.id = enrollment.account_id AND account.deleted_at IS NULL
     WHERE enrollment.competition_id = $1 AND enrollment.withdrawn_at IS NULL
     ORDER BY enrollment.account_id`,
    [competition.id]
  );
  const accountIds = participants.rows.map((row) => row.account_id);

  const activities = accountIds.length
    ? await db.query<ActivityRow>(
        `SELECT submission.account_id, output.active_duration_seconds, submission.processed_at
         FROM activity_submissions submission
         JOIN activity_validation_outputs output ON output.activity_id = submission.id
         WHERE submission.account_id = ANY($1::uuid[])
           AND submission.status = 'derived'
           AND submission.deleted_at IS NULL
           AND submission.processed_at >= $2
           AND submission.processed_at < $3
         ORDER BY submission.account_id, submission.processed_at`,
        [accountIds, window.periodStart, window.periodEnd]
      )
    : { rows: [] as ActivityRow[] };

  const byAccount = new Map<string, ScoredActivity[]>();
  for (const row of activities.rows) {
    const bucket = byAccount.get(row.account_id) ?? [];
    bucket.push({
      activeDurationSeconds: row.active_duration_seconds,
      endedAt: row.processed_at
    });
    byAccount.set(row.account_id, bucket);
  }

  const scored = accountIds
    .map((accountId) => ({
      accountId,
      score: challengeModeScore(
        competition.mode,
        window,
        byAccount.get(accountId) ?? [],
        // No quest completion is recorded anywhere, which is why no rule
        // enables that mode and this list is never the scoring input.
        [],
        rule.dailyCapMinutes,
        rule.minMinutesPerActiveDay
      )
    }))
    .sort(
      (left, right) => right.score - left.score || left.accountId.localeCompare(right.accountId)
    );
  const ranks = competitionRanking(scored.map((entry) => entry.score));

  await withTransaction(db, async (client) => {
    const claimed = await client.query<{ id: string }>(
      `UPDATE competitions SET status = 'closed', closed_at = now()
       WHERE id = $1 AND status IN ('published', 'open') RETURNING id`,
      [competition.id]
    );
    // Another sweep got there first; its transaction owns the result rows.
    if (!claimed.rows[0]) return;
    for (const [index, entry] of scored.entries()) {
      await client.query(
        `INSERT INTO competition_results (competition_id, account_id, score, rank)
         VALUES ($1, $2, $3, $4) ON CONFLICT (competition_id, account_id) DO NOTHING`,
        [competition.id, entry.accountId, entry.score, ranks[index]!]
      );
    }
    // The 014 inbox trigger fans each row out to `notification.created`. The
    // body carries no score and no rank, and it says the result is provisional
    // because at this moment it is: the dispute period has just started.
    for (const entry of scored) {
      await client.query(
        `INSERT INTO notification_inbox (account_id, kind, title, body, deep_link)
         VALUES ($1, 'competition', 'Competition closed',
           'The competition has finished. Results are provisional until the dispute period ends.',
           $2)`,
        [entry.accountId, `runsphere://competitions/${competition.id}`]
      );
    }
  });
  return true;
};

/**
 * Advance every competition the clock has moved past.
 *
 * Opening and finalizing are status changes only — no scores are involved —
 * so they are single guarded updates. Closing is the one that scores, and it
 * runs through `closeCompetition`.
 */
export const processCompetitions = async (
  db: Database,
  now: Date = new Date()
): Promise<number> => {
  const due = await db.query<DueCompetitionRow>(
    `SELECT id, mode, status, period_start, period_end, dispute_period_hours, rule_version,
       closed_at
     FROM competitions
     WHERE status IN ('published', 'open', 'closed')
     ORDER BY period_end
     LIMIT 100`
  );

  let advanced = 0;
  for (const competition of due.rows) {
    const next = competitionStatusDue(
      {
        status: competition.status,
        opensAt: kolkataDateStart(asDateString(competition.period_start)),
        closesAt: kolkataDateStart(asDateString(competition.period_end)),
        disputePeriodHours: competition.dispute_period_hours,
        closedAt: competition.closed_at ?? undefined
      },
      now
    );
    if (!next) continue;

    if (next === 'open') {
      const opened = await db.query<{ id: string }>(
        `UPDATE competitions SET status = 'open'
         WHERE id = $1 AND status = 'published' RETURNING id`,
        [competition.id]
      );
      if (opened.rows[0]) advanced += 1;
      continue;
    }
    if (next === 'closed') {
      if (await closeCompetition(db, competition)) advanced += 1;
      continue;
    }
    if (next === 'finalized') {
      // The dispute period has elapsed. Nothing is rescored: this records that
      // the stated span passed and the result is no longer provisional.
      const finalized = await db.query<{ id: string }>(
        `UPDATE competitions SET status = 'finalized', finalized_at = now()
         WHERE id = $1 AND status = 'closed' RETURNING id`,
        [competition.id]
      );
      if (finalized.rows[0]) advanced += 1;
    }
  }
  return advanced;
};
