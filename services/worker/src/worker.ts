import {
  createDatabase,
  defaultDatabaseUrl,
  prepareSchema,
  withTransaction,
  type Database
} from '@runsphere/db';
import { createLogger, type Logger } from '@runsphere/observability';
import { processActivity } from '@runsphere/api/activity';
import { syncAchievementsForActivity } from '@runsphere/api/achievements';
import { completeQuestsForActivity } from '@runsphere/api/quests';
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
import { processTerritory } from './territory-scoring.js';
import { processTerritorySeasons } from './territory-season.js';
import { processTerritoryGeoTags } from './territory-geo-backfill.js';
import { processTerritoryRanks } from './territory-rank-job.js';
import { processTerritorySeasonReset } from './territory-season-reset-job.js';
import { processTerritorySeasonEnding } from './territory-season-ending-job.js';
import { processMlFeatureExtraction } from './ml-feature-extractor-job.js';
import { processProgressionWeekClose } from './progression-week-close.js';
import { processActivityMetricsBackfill } from './activity-metrics-backfill.js';
import {
  processAnticheatRetrain,
  processQuestRecommendRetrain,
  readMlTrainerConfig
} from './ml-retrain-job.js';
import { createConfiguredDelivery } from './delivery.js';
import type { DeliveryHandler } from './push-delivery.js';

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
      // Keyed by address rather than account, so nothing cascades to it. The
      // request has done its job once erasure runs, and keeping the address
      // afterwards would retain exactly the identifier erasure exists to
      // remove (ADR-0012). `email_suppressions` is deliberately left alone: a
      // do-not-email list is how a past complaint or bounce stays honoured.
      await client.query(
        `DELETE FROM public_deletion_requests
         WHERE lower(email) = (SELECT lower(email) FROM accounts WHERE id = $1)`,
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

/**
 * One maintenance job: a name for the logs and a function returning how much
 * it did. Order in `maintenanceJobs` is the order a sweep runs them in.
 */
export interface MaintenanceJob {
  readonly name: string;
  readonly run: (db: Database, now: Date) => Promise<number>;
}

/**
 * The scheduled jobs, in sweep order. The order still matters and is unchanged:
 *
 * - Deletion settles before challenge windows are queued, so an erased
 *   participant is never scored.
 * - Relays, club challenges, the global board and competitions recompute after
 *   deletions and departures, so they reflect them.
 * - Sanctions close after erasure; an expired sanction on a deleted account is
 *   nothing to record.
 * - Territory (H3 seasons) is wired in but refuses on
 *   `TERRITORY_CAPTURE_ENABLED` before its first query.
 * - Turf runs in the order a month happens: geo-tag, weekly rank, ending
 *   warning, reset. All four are state-driven, so an idle sweep is a handful of
 *   indexed reads.
 * - Run metrics backfill first, while raw points still exist (M9 9.10).
 * - ML feature extraction runs while raw traces still exist (30 days); the
 *   retrain proposals no-op without a training service.
 * - Campaigns resolve their audience last, so consent revoked anywhere in the
 *   sweep is already reflected.
 */
export const maintenanceJobs: readonly MaintenanceJob[] = [
  // Before the purge, so a run on its last day of raw points still gets metrics.
  { name: 'activity_metrics_backfill', run: (db) => processActivityMetricsBackfill(db) },
  { name: 'raw_trace_purge', run: (db) => purgeExpiredRawTraces(db) },
  { name: 'account_deletion', run: (db) => convergeAccountDeletion(db) },
  { name: 'safety_share_expiry', run: (db) => expireSafetyShares(db) },
  { name: 'challenge_invite_expiry', run: (db) => cancelExpiredChallengeInvites(db) },
  { name: 'challenge_enqueue', run: (db) => enqueueDueChallenges(db) },
  { name: 'club_relays', run: (db) => processClubRelays(db) },
  { name: 'club_challenges', run: (db) => processClubChallenges(db) },
  { name: 'global_boards', run: (db) => processGlobalBoards(db) },
  { name: 'competitions', run: (db) => processCompetitions(db) },
  { name: 'sanction_expiry', run: (db) => expireSanctions(db) },
  {
    // After account deletion, so an erased account is never granted XP (B2).
    name: 'progression_week_close',
    run: async (db, now) => (await processProgressionWeekClose({ db }, now)).accountsFinalized
  },
  {
    name: 'territory_scoring',
    run: async (db, now) => (await processTerritory({ db }, now)).contributionsWritten
  },
  {
    name: 'territory_seasons',
    run: async (db, now) => (await processTerritorySeasons({ db }, now)).weeksFinalized
  },
  {
    name: 'turf_geo_tags',
    run: async (db, now) => (await processTerritoryGeoTags({ db }, now)).tagged
  },
  {
    name: 'turf_weekly_ranks',
    run: async (db, now) => (await processTerritoryRanks({ db }, now)).rowsWritten
  },
  {
    name: 'turf_season_ending',
    run: async (db, now) =>
      (await processTerritorySeasonEnding({ db }, now))?.notificationsQueued ?? 0
  },
  {
    name: 'turf_season_reset',
    run: async (db, now) => (await processTerritorySeasonReset({ db }, now)).claimsArchived
  },
  {
    name: 'ml_feature_extraction',
    run: async (db) => (await processMlFeatureExtraction({ db })).extracted
  },
  {
    name: 'ml_retrain_proposals',
    run: async (db, now) => {
      const trainer = readMlTrainerConfig(process.env);
      const deps = { db, ...(trainer ? { trainer } : {}) };
      await processAnticheatRetrain(deps, now);
      await processQuestRecommendRetrain(deps, now);
      return 0;
    }
  },
  { name: 'campaigns', run: (db) => processCampaigns(db) }
];

/**
 * Run every maintenance job once, in order, each in isolation.
 *
 * A job that throws is logged and skipped; the rest still run. Previously one
 * failing job (a geocode, a campaign) aborted the whole sweep and, because the
 * sweep ran before every activity, stopped all activity processing with it
 * (B3). Each job is already idempotent and state-driven, so a skipped job
 * simply catches up on the next sweep.
 */
export const processMaintenance = async (
  db: Database,
  now: Date = new Date(),
  logger?: Logger,
  jobs: readonly MaintenanceJob[] = maintenanceJobs
): Promise<number> => {
  let total = 0;
  for (const job of jobs) {
    try {
      total += await job.run(db, now);
    } catch (error) {
      logger?.error('worker.maintenance_job_failed', {
        job: job.name,
        error: safeWorkerError(error)
      });
    }
  }
  return total;
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

/**
 * What runs once a run has been processed (M1.7): award any achievement the
 * run unlocked, so awards no longer wait for the Achievements screen. Best
 * effort by design: the run is already derived and committed, awards are
 * idempotent, and `POST /v1/achievements/sync` still catches anything missed,
 * so a failure here is logged and never fails or retries the run.
 */
export type AfterActivityProcessed = (db: Database, activityId: string) => Promise<void>;

const awardAchievements: AfterActivityProcessed = async (db, activityId) => {
  try {
    await syncAchievementsForActivity(db, activityId);
  } catch (error) {
    createLogger('worker').error('worker.achievement_sync_failed', {
      error: safeWorkerError(error)
    });
  }
  // Quests (M6.3) on the same terms: best effort, idempotent, never fails the run.
  try {
    await completeQuestsForActivity(db, activityId);
  } catch (error) {
    createLogger('worker').error('worker.quest_completion_failed', {
      error: safeWorkerError(error)
    });
  }
};

export const processNextActivity = async (
  db: Database,
  afterProcessed: AfterActivityProcessed = awardAchievements
): Promise<boolean> => {
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
    await afterProcessed(db, event.rows[0].aggregate_id);
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
/** How often scheduled maintenance runs. Queues are drained continuously. */
export const defaultMaintenanceIntervalMs = 30_000;
/** Queue rounds per cycle, so a flood of work still lets maintenance run. */
export const drainRoundLimit = 200;

export interface WorkerCycleDeps {
  db: Database;
  deliver: DeliveryHandler;
  logger: Logger;
  /** Injected for tests; defaults to the real implementations. */
  maintenance?: (db: Database, now: Date, logger: Logger) => Promise<number>;
  nextActivity?: (db: Database) => Promise<boolean>;
  nextChallenge?: (db: Database) => Promise<boolean>;
  nextDelivery?: (db: Database, deliver: DeliveryHandler) => Promise<boolean>;
}

export interface WorkerCycleState {
  /** Epoch ms of the last maintenance sweep; 0 means "never", so the first cycle runs one. */
  lastMaintenanceAt: number;
}

/**
 * Drain the three queues until they are empty (or `drainRoundLimit` rounds),
 * then run maintenance if its interval has passed.
 *
 * Before this, every loop ran the full maintenance sweep and then processed at
 * most one activity, so a backlog of N runs cost N sweeps of ~20 jobs (B3).
 * Queue failures are already recorded on their outbox rows by the
 * `processNext*` functions; a failure of the claim query itself is logged here
 * and ends this drain rather than the worker.
 */
export const runWorkerCycle = async (
  deps: WorkerCycleDeps,
  state: WorkerCycleState,
  now: number = Date.now(),
  maintenanceIntervalMs: number = defaultMaintenanceIntervalMs
): Promise<{ processed: number; ranMaintenance: boolean }> => {
  const nextActivity = deps.nextActivity ?? processNextActivity;
  const nextChallenge = deps.nextChallenge ?? processNextChallengeFinish;
  const nextDelivery = deps.nextDelivery ?? processNextDelivery;
  const maintenance = deps.maintenance ?? processMaintenance;

  let processed = 0;
  try {
    for (let round = 0; round < drainRoundLimit; round += 1) {
      const hadActivity = await nextActivity(deps.db);
      const hadChallenge = await nextChallenge(deps.db);
      const hadDelivery = await nextDelivery(deps.db, deps.deliver);
      const worked = Number(hadActivity) + Number(hadChallenge) + Number(hadDelivery);
      processed += worked;
      if (worked === 0) break;
    }
  } catch (error) {
    deps.logger.error('worker.queue_drain_failed', { error: safeWorkerError(error) });
  }

  let ranMaintenance = false;
  if (now - state.lastMaintenanceAt >= maintenanceIntervalMs) {
    state.lastMaintenanceAt = now;
    ranMaintenance = true;
    try {
      await maintenance(deps.db, new Date(now), deps.logger);
    } catch (error) {
      // processMaintenance isolates its own jobs; this only catches an
      // injected implementation that does not.
      deps.logger.error('worker.maintenance_failed', { error: safeWorkerError(error) });
    }
  }
  return { processed, ranMaintenance };
};

const maintenanceIntervalFrom = (environment: NodeJS.ProcessEnv): number => {
  const configured = Number(environment.WORKER_MAINTENANCE_INTERVAL_MS);
  return Number.isFinite(configured) && configured >= 1_000
    ? configured
    : defaultMaintenanceIntervalMs;
};

export const runWorker = async (): Promise<void> => {
  const db = createDatabase(defaultDatabaseUrl(process.env));
  const logger = createLogger('worker');
  await prepareSchema(db, process.env);
  startWorker(logger);
  // Push and email are both gated on provider credentials. Without them each
  // handler is a logged no-op rather than a failure, so events still drain and
  // the durable inbox stays the delivery of record (ADR-0009). Which providers
  // are actually configured is logged at startup by `createConfiguredDelivery`.
  const deliver = createConfiguredDelivery(db, logger);
  const once = process.env.WORKER_ONCE === 'true';
  const interval = maintenanceIntervalFrom(process.env);
  const state: WorkerCycleState = { lastMaintenanceAt: 0 };
  try {
    do {
      const { processed } = await runWorkerCycle(
        { db, deliver, logger },
        state,
        Date.now(),
        interval
      );
      if (!once && processed === 0) await sleep(pollMilliseconds);
    } while (!once);
  } finally {
    await db.end();
  }
};
