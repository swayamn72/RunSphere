import { createDatabase, defaultDatabaseUrl, migrate, type Database } from '@runsphere/db';
import { createLogger, type Logger } from '@runsphere/observability';
import { processActivity } from '@runsphere/api/activity';

export interface WorkerStartupResult {
  service: 'worker';
  status: 'ready';
  queuedJobs: number;
}

export const processNextActivity = async (db: Database): Promise<boolean> => {
  const event = await db.query<{ id: string; aggregate_id: string }>(
    `UPDATE outbox_events SET claimed_at = now(), attempts = attempts + 1
     WHERE id = (SELECT id FROM outbox_events WHERE topic = 'activity.finalized' AND processed_at IS NULL AND claimed_at IS NULL ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
     RETURNING id, aggregate_id`
  );
  if (!event.rows[0]) return false;
  await processActivity(db, event.rows[0].aggregate_id);
  await db.query('UPDATE outbox_events SET processed_at = now() WHERE id = $1', [event.rows[0].id]);
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
  const logger = createLogger('worker');
  startWorker(logger);
  while (await processNextActivity(db)) {
    // Drain the bounded outbox batch before this short-lived worker exits.
  }
  await db.end();
};
