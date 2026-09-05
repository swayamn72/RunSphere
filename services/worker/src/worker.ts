import {
  createDatabase,
  defaultDatabaseUrl,
  migrate,
  withTransaction,
  type Database
} from '@runsphere/db';
import { createLogger, type Logger } from '@runsphere/observability';
import { processActivity } from '@runsphere/api/activity';
import {
  CHALLENGE_FINISHED_TOPIC,
  cancelExpiredChallengeInvites,
  enqueueDueChallenges,
  scoreChallenge
} from './challenge-scoring.js';
import { processClubChallenges } from './club-challenges.js';
import { processClubRelays } from './club-relays.js';
import { CAMPAIGN_TOPIC, processCampaigns } from './campaigns.js';
import { processCompetitions } from './competitions.js';
import { processGlobalBoards } from './global-boards.js';
import {
  createFcmSender,
  createPushDelivery,
  readFcmCredentials,
  type DeliveryHandler
} from './push-delivery.js';

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
      // A club whose owner is erased would otherwise be left with members and
      // nobody able to appoint an admin or archive it, because the membership
      // row cascades away with the account. Archiving ends access for everyone
      // while the remaining membership rows stay as the audited record.
      await client.query(
        `UPDATE clubs SET archived_at = now()
         WHERE archived_at IS NULL AND id IN (
           SELECT club_id FROM club_memberships
           WHERE account_id = $1 AND role = 'owner' AND left_at IS NULL)`,
        [account.id]
      );
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

/**
 * Close out sanctions the clock has ended (milestone 3.7).
 *
 * A sanction with an `expires_at` in the past no longer applies, and the read
 * paths already treat it that way. Recording the expiry gives the account and
 * any later audit one unambiguous end time instead of a row that has to be
 * re-derived from the clock every time it is read. Warnings never expire, so
 * they are never touched here.
 */
export const expireSanctions = async (db: Database): Promise<number> => {
  const expired = await db.query<{ id: string }>(
    `UPDATE sanctions SET revoked_at = expires_at, revoked_reason = 'expired'
     WHERE revoked_at IS NULL AND expires_at IS NOT NULL AND expires_at <= now()
     RETURNING id`
  );
  return expired.rows.length;
};

export const processMaintenance = async (db: Database): Promise<number> => {
  // Deletion can remove the same traces and share records touched by the other jobs.
  const purgedTraces = await purgeExpiredRawTraces(db);
  const deletedAccounts = await convergeAccountDeletion(db);
  const expiredShares = await expireSafetyShares(db);
  const lapsedInvites = await cancelExpiredChallengeInvites(db);
  // Enqueue after deletion so a closed window belonging to an erased account is
  // never queued for scoring.
  const dueChallenges = await enqueueDueChallenges(db);
  // Relay totals are a recompute, so running them last means they already
  // reflect this sweep's deletions and departures.
  const relays = await processClubRelays(db);
  // Club challenges are finished after deletion too, so a closed window is
  // never scored with a participant the same sweep has just erased. Unlike the
  // 1v1 flow this writes the result directly: the `status = 'active'` claim is
  // the idempotence, so a failed pass simply retries on the next sweep.
  const clubChallenges = await processClubChallenges(db);
  // The global board is a full recompute of two weeks and reads the widest set
  // of accounts, so it runs last: it then reflects every departure, deletion,
  // and revoked opt-in this sweep has already settled.
  const globalBoard = await processGlobalBoards(db);
  // Competitions are advanced last: the clock decides their states, and by
  // this point every deletion, withdrawal, and validation this sweep settled
  // is already reflected in what a closing event will score.
  const competitions = await processCompetitions(db);
  // Sanctions are closed out last, after any account erased in this sweep is
  // already gone: an expired sanction on a deleted account is nothing to
  // record.
  const sanctions = await expireSanctions(db);
  // Campaign sends resolve their audience last, so consent revoked anywhere in
  // this sweep — including by an unsubscribe — is already reflected in who the
  // send will reach.
  const campaigns = await processCampaigns(db);
  return (
    purgedTraces +
    deletedAccounts +
    expiredShares +
    lapsedInvites +
    dueChallenges +
    relays +
    clubChallenges +
    globalBoard +
    competitions +
    sanctions +
    campaigns
  );
};

/**
 * Score one challenge whose window has closed. Scoring is separate from
 * delivery so a provider outage never blocks results, and a scoring failure
 * retries under the same attempt budget as activity validation.
 */
export const processNextChallengeFinish = async (db: Database): Promise<boolean> => {
  const event = await db.query<{ id: string; aggregate_id: string }>(
    `UPDATE outbox_events SET claimed_at = now(), attempts = attempts + 1, last_error = NULL
     WHERE id = (SELECT event.id FROM outbox_events event
       WHERE event.topic = $1 AND event.processed_at IS NULL AND event.failed_at IS NULL
         AND event.attempts < $2
         AND (event.claimed_at IS NULL OR event.claimed_at < now() - $3::interval)
       ORDER BY event.created_at FOR UPDATE OF event SKIP LOCKED LIMIT 1)
     RETURNING id, aggregate_id`,
    [CHALLENGE_FINISHED_TOPIC, maxAttempts, `${staleClaimSeconds} seconds`]
  );
  if (!event.rows[0]) return false;
  try {
    await scoreChallenge(db, event.rows[0].aggregate_id);
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
export type { DeliveryHandler };

const deliveryTopics = ['notification.created', 'email.transactional', CAMPAIGN_TOPIC] as const;

// Push (FCM) and transactional email providers are a gated dependency: the
// Foundation gate proves inbox -> outbox -> worker end to end, but real
// delivery is wired in later. This default no-ops rather than dropping events.
const deferredDelivery: DeliveryHandler = (_topic, _aggregateId, _payload) => Promise.resolve();

export const processNextDelivery = async (
  db: Database,
  deliver: DeliveryHandler = deferredDelivery
): Promise<boolean> => {
  const event = await db.query<{
    id: string;
    topic: string;
    aggregate_id: string;
    payload: unknown;
  }>(
    `UPDATE outbox_events SET claimed_at = now(), attempts = attempts + 1, last_error = NULL
     WHERE id = (SELECT event.id FROM outbox_events event
       WHERE event.topic = ANY($1::text[]) AND event.processed_at IS NULL AND event.failed_at IS NULL AND event.attempts < $2
       AND (event.claimed_at IS NULL OR event.claimed_at < now() - $3::interval)
       ORDER BY event.created_at FOR UPDATE OF event SKIP LOCKED LIMIT 1)
     RETURNING id, topic, aggregate_id, payload`,
    [deliveryTopics, maxAttempts, `${staleClaimSeconds} seconds`]
  );
  if (!event.rows[0]) return false;
  try {
    await deliver(event.rows[0].topic, event.rows[0].aggregate_id, event.rows[0].payload);
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
  // Push is gated on provider credentials. Without them the handler is a
  // logged no-op rather than a failure, so notification events still drain and
  // the durable inbox stays the delivery of record (ADR-0009).
  const credentials = readFcmCredentials(process.env);
  const deliver = createPushDelivery({
    db,
    logger,
    ...(credentials ? { sender: createFcmSender(credentials) } : {})
  });
  logger.info('worker.push_provider', { configured: credentials !== undefined });
  const once = process.env.WORKER_ONCE === 'true';
  try {
    do {
      try {
        await processMaintenance(db);
        const hadActivity = await processNextActivity(db);
        const hadChallenge = await processNextChallengeFinish(db);
        const hadDelivery = await processNextDelivery(db, deliver);
        if (!hadActivity && !hadChallenge && !hadDelivery) await sleep(pollMilliseconds);
      } catch (error) {
        logger.error('worker.iteration_failed', { error: safeWorkerError(error) });
        if (!once) await sleep(pollMilliseconds);
      }
    } while (!once);
  } finally {
    await db.end();
  }
};
