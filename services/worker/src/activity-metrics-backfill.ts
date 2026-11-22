import { withTransaction, type Database } from '@runsphere/db';
import { loadPoints, writeActivityMetrics } from '@runsphere/api/activity';
import { RUN_METRICS_VERSION } from '@runsphere/domain';

/**
 * Metrics for runs derived before they existed, or by an older
 * `RUN_METRICS_VERSION` (M9 9.10).
 *
 * New runs get their metrics inside `processActivity`. This catches the rest:
 * runs derived before migration 055, and every run when a metrics definition
 * changes. It can only work while the raw points exist; they are purged 30 days
 * after the run (`raw_trace_purge`), so an older run simply has no metrics and
 * the app shows its totals alone. That is why this job runs before the purge in
 * the sweep: a run on its last day gets one more chance.
 *
 * Newest first, because those are the runs people open. Each run is its own
 * transaction with its submission row locked, `SKIP LOCKED` so it never waits
 * on a derivation or a deletion in progress; `writeActivityMetrics` only
 * replaces an older version, so two workers can't undo each other.
 */
export const METRICS_BACKFILL_BATCH = 25;

export const processActivityMetricsBackfill = async (
  db: Database,
  batch = METRICS_BACKFILL_BATCH
): Promise<number> => {
  const due = await db.query<{ id: string }>(
    `SELECT submission.id FROM activity_submissions submission
     JOIN accounts account ON account.id = submission.account_id
     LEFT JOIN activity_metrics metrics ON metrics.activity_id = submission.id
     WHERE submission.status = 'derived' AND submission.deleted_at IS NULL
       AND submission.raw_trace_purged_at IS NULL
       AND account.deletion_requested_at IS NULL
       AND (metrics.activity_id IS NULL OR metrics.metrics_version < $1)
       AND EXISTS (SELECT 1 FROM activity_chunks chunk WHERE chunk.activity_id = submission.id)
     ORDER BY submission.processed_at DESC NULLS LAST, submission.id
     LIMIT $2`,
    [RUN_METRICS_VERSION, batch]
  );
  let written = 0;
  for (const { id } of due.rows) {
    written += await withTransaction(db, async (client) => {
      const locked = await client.query(
        `SELECT 1 FROM activity_submissions
         WHERE id = $1 AND status = 'derived' AND deleted_at IS NULL
           AND raw_trace_purged_at IS NULL
         FOR UPDATE SKIP LOCKED`,
        [id]
      );
      if (!locked.rows[0]) return 0;
      const points = await loadPoints(client, id);
      if (points.length === 0) return 0;
      await writeActivityMetrics(client, id, points);
      return 1;
    });
  }
  return written;
};
