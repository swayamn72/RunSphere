import { createDatabase, defaultDatabaseUrl, migrate, type Database } from '@runsphere/db';
import { createLogger, type Logger } from '@runsphere/observability';
import { processActivity } from '@runsphere/api/activity';

const maxAttempts = 5;
const staleClaimSeconds = 300;
const pollMilliseconds = 5_000;
export interface WorkerStartupResult {
  service: 'worker';
  status: 'ready';
  queuedJobs: number;
}
const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
const safeWorkerError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : 'unknown worker error';
  return message
    .replace(/(password|token|authorization|cookie)\s*[=:]\s*[^\s,]+/gi, '$1=[REDACTED]')
    .replace(/-?\d{1,3}\.\d{3,}/g, '[REDACTED]')
    .slice(0, 500);
};

export const processNextActivity = async (db: Database): Promise<boolean> => {
  const event = await db.query<{ id: string; aggregate_id: string }>(
    `UPDATE outbox_events SET claimed_at = now(), attempts = attempts + 1, last_error = NULL
     WHERE id = (SELECT event.id FROM outbox_events event
       JOIN activity_submissions submission ON submission.id = event.aggregate_id
       WHERE event.topic = 'activity.finalized' AND event.processed_at IS NULL AND event.failed_at IS NULL AND event.attempts < $1
       AND submission.deleted_at IS NULL AND submission.status = 'validating'
       AND (event.claimed_at IS NULL OR event.claimed_at < now() - $2::interval)
       ORDER BY event.created_at FOR UPDATE OF event SKIP LOCKED LIMIT 1)
     RETURNING id, aggregate_id`,
    [maxAttempts, `${staleClaimSeconds} seconds`]
  );
  if (!event.rows[0]) return false;
  try {
    await processActivity(db, event.rows[0].aggregate_id);
    await db.query('UPDATE outbox_events SET processed_at = now() WHERE id = $1', [
      event.rows[0].id
    ]);
  } catch (error) {
    await db.query(
      'UPDATE outbox_events SET claimed_at = NULL, last_error = $2, failed_at = CASE WHEN attempts >= $3 THEN now() ELSE NULL END WHERE id = $1',
      [event.rows[0].id, safeWorkerError(error), maxAttempts]
    );
  }
  return true;
};
export const startWorker = (logger: Logger = createLogger('worker')): WorkerStartupResult => {
  const result: WorkerStartupResult = { service: 'worker', status: 'ready', queuedJobs: 0 };
  logger.info('worker.started', { ...result });
  return result;
};
export const runWorker = async (): Promise<void> => {
  const db = createDatabase(defaultDatabaseUrl(process.env));
  await migrate(db);
  startWorker(createLogger('worker'));
  const once = process.env.WORKER_ONCE === 'true';
  try {
    do {
      if (!(await processNextActivity(db))) await sleep(pollMilliseconds);
    } while (!once);
  } finally {
    await db.end();
  }
};
