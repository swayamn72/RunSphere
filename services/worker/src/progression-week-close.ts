import type { Database } from '@runsphere/db';
import { kolkataDate, kolkataDateStart, weeklyPeriodStart } from '@runsphere/domain';
import { finalizeProgressionWeek, loadActiveProgressionRule } from '@runsphere/api/progression';

/**
 * Persist activity XP for closed Asia/Kolkata weeks (B2).
 *
 * The current week's XP is a live projection in `GET /v1/progression`; a week
 * only counts toward the lifetime total once its grants are written to
 * `xp_entries`. That used to happen only when a client called
 * `POST /v1/progression/sync`, which none does, so totals and levels fell back
 * every Monday. This job does it on the server, through the same
 * `finalizeProgressionWeek` the sync route uses.
 *
 * State-driven and bounded, like the season jobs:
 *
 * - One week per sweep, oldest unfinalized closed week first.
 * - Weeks are finalized in order, so everything up to the newest finalized week
 *   is done and only activity after it is scanned; an idle sweep is two
 *   indexed reads.
 * - A week is marked `progression_finalized_at` only after every account that
 *   ran in it has been written. A failure part-way leaves it unmarked and the
 *   next sweep repeats it; grants are idempotent, so nothing doubles.
 */
export interface ProgressionWeekCloseOutcome {
  week: string | undefined;
  accountsFinalized: number;
}

const KOLKATA_WEEK = `(date_trunc('week', submission.processed_at AT TIME ZONE 'Asia/Kolkata'))::date`;

export const processProgressionWeekClose = async (
  { db }: { db: Database },
  now: Date = new Date()
): Promise<ProgressionWeekCloseOutcome> => {
  const loaded = await loadActiveProgressionRule(db);
  if (!loaded) return { week: undefined, accountsFinalized: 0 };

  const currentWeek = kolkataDate(weeklyPeriodStart(now));
  const next = await db.query<{ week: string }>(
    `SELECT ${KOLKATA_WEEK}::text AS week
     FROM activity_submissions submission
     LEFT JOIN weekly_periods period ON period.period_start = ${KOLKATA_WEEK}
     WHERE submission.status = 'derived'
       AND submission.deleted_at IS NULL
       AND submission.processed_at IS NOT NULL
       AND ${KOLKATA_WEEK} < $1::date
       AND period.progression_finalized_at IS NULL
       AND submission.processed_at >= coalesce(
         (SELECT max(period_start) + 7 FROM weekly_periods
          WHERE progression_finalized_at IS NOT NULL)::timestamp AT TIME ZONE 'Asia/Kolkata',
         '-infinity'::timestamptz)
     ORDER BY 1
     LIMIT 1`,
    [currentWeek]
  );
  const week = next.rows[0]?.week;
  if (!week) return { week: undefined, accountsFinalized: 0 };

  const weekStart = kolkataDateStart(week);
  const weekEnd = new Date(weekStart.getTime() + 7 * 86_400_000);
  const accounts = await db.query<{ account_id: string }>(
    `SELECT DISTINCT account_id FROM activity_submissions
     WHERE status = 'derived' AND deleted_at IS NULL
       AND processed_at >= $1 AND processed_at < $2`,
    [weekStart, weekEnd]
  );
  for (const account of accounts.rows) {
    await finalizeProgressionWeek(db, account.account_id, weekStart, loaded);
  }
  await db.query(
    `INSERT INTO weekly_periods (period_start, period_end, progression_finalized_at)
     VALUES ($1::date, $1::date + 7, now())
     ON CONFLICT (period_start) DO UPDATE
       SET progression_finalized_at = coalesce(weekly_periods.progression_finalized_at, now())`,
    [week]
  );
  return { week, accountsFinalized: accounts.rows.length };
};
