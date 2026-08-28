import {
  createDatabase,
  defaultDatabaseUrl,
  migrate,
  withTransaction,
  type Database
} from '@runsphere/db';
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

export const purgeExpiredRawTraces = async (db: Database): Promise<number> => {
  const expired = await db.query<{ id: string }>(
    `WITH due AS (
       SELECT id FROM activity_submissions
       WHERE deleted_at IS NULL AND raw_trace_purged_at IS NULL AND raw_trace_retention_until <= now()
     ), purged AS (
       DELETE FROM activity_chunks WHERE activity_id IN (SELECT id FROM due)
     ), raw_objects AS (
       UPDATE raw_trace_objects SET purged_at = now()
       WHERE activity_id IN (SELECT id FROM due) AND purged_at IS NULL
     )
     UPDATE activity_submissions submission SET raw_trace_purged_at = now()
     WHERE submission.id IN (SELECT id FROM due)
     RETURNING submission.id`
  );
  return expired.rows.length;
};

/** Converges user-requested deletion by removing all personal records and retaining only an abuse tombstone. */
export const convergeAccountDeletion = async (db: Database): Promise<number> => {
  const accounts = await db.query<{ id: string }>(
    `SELECT id FROM accounts WHERE deletion_requested_at IS NOT NULL AND deleted_at IS NULL
     ORDER BY deletion_requested_at LIMIT 25`
  );
  for (const account of accounts.rows) {
    await withTransaction(db, async (client) => {
      const owned = await client.query<{ id: string }>(
        `SELECT id FROM accounts WHERE id = $1 AND deletion_requested_at IS NOT NULL
         AND deleted_at IS NULL FOR UPDATE`,
        [account.id]
      );
      if (!owned.rows[0]) return;
      await client.query(
        `INSERT INTO account_deletion_tombstones (account_id, deleted_at)
         VALUES ($1, now()) ON CONFLICT (account_id) DO NOTHING`,
        [account.id]
      );
      await client.query(
        `DELETE FROM outbox_events WHERE aggregate_id IN
         (SELECT id FROM activity_submissions WHERE account_id = $1)`,
        [account.id]
      );
      await client.query('DELETE FROM activity_submissions WHERE account_id = $1', [account.id]);
      await client.query(
        `DELETE FROM safety_share_updates WHERE share_session_id IN
         (SELECT id FROM safety_share_sessions WHERE account_id = $1)`,
        [account.id]
      );
      await client.query('DELETE FROM safety_share_sessions WHERE account_id = $1', [account.id]);
      await client.query(
        `DELETE FROM safety_contacts
         WHERE account_id = $1 OR lower(email) = (SELECT lower(email) FROM accounts WHERE id = $1)`,
        [account.id]
      );
      await client.query('DELETE FROM account_export_requests WHERE account_id = $1', [account.id]);
      await client.query(
        'DELETE FROM account_audit_events WHERE account_id = $1 OR actor_account_id = $1',
        [account.id]
      );
      await client.query(
        'DELETE FROM privacy_audit_events WHERE account_id = $1 OR actor_account_id = $1',
        [account.id]
      );
      await client.query('DELETE FROM privacy_zones WHERE account_id = $1', [account.id]);
      await client.query("SELECT set_config('runsphere.account_erasure', 'on', true)");
      await client.query('DELETE FROM accounts WHERE id = $1', [account.id]);
    });
  }
  return accounts.rows.length;
};

export const expireSafetyShares = async (db: Database): Promise<number> => {
  const expired = await db.query<{ id: string }>(
    `UPDATE safety_share_sessions SET status = 'expired'
     WHERE status = 'active' AND expires_at <= now() RETURNING id`
  );
  return expired.rows.length;
};

export const processMaintenance = async (db: Database): Promise<number> => {
  // Deletion can remove the same traces and share records touched by the other jobs.
  const purgedTraces = await purgeExpiredRawTraces(db);
  const deletedAccounts = await convergeAccountDeletion(db);
  const expiredShares = await expireSafetyShares(db);
  return purgedTraces + deletedAccounts + expiredShares;
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
  const logger = createLogger('worker');
  await migrate(db);
  startWorker(logger);
  const once = process.env.WORKER_ONCE === 'true';
  try {
    do {
      try {
        await processMaintenance(db);
        if (!(await processNextActivity(db))) await sleep(pollMilliseconds);
      } catch (error) {
        logger.error('worker.iteration_failed', { error: safeWorkerError(error) });
        if (!once) await sleep(pollMilliseconds);
      }
    } while (!once);
  } finally {
    await db.end();
  }
};
