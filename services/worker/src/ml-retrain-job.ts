import type { Database } from '@runsphere/db';
import {
  ML_TRAINING_SET_FLOOR,
  QUEST_RETRAIN_INTERVAL_DAYS,
  mlPromotionAdvice,
  questModelIsWorthFitting
} from '@runsphere/domain';

/**
 * Proposing a retrained model (`ml.md` System 1 Phase 4, System 2 retrain
 * cadence).
 *
 * **This job proposes. It never promotes.** `ml.md` key constraint 4: "The
 * worker proposes a new model; a staff reviewer promotes it." So what happens
 * here is: ask the training service to fit a candidate, write it into
 * `ml_models` unpromoted, and stop. Nothing this job does changes what scores a
 * run. A reviewer promotes by setting `promoted_at` and `promoted_by_account_id`,
 * and the partial unique index in `044` makes exactly one live per kind.
 *
 * **State-driven, like the season jobs.** It asks "has a month passed since the
 * last anti-cheat proposal" rather than waiting for the 1st, so a worker that
 * was down on the 1st still proposes when it comes back instead of skipping the
 * month. The same for the recommender's week.
 *
 * **Unconfigured is the normal state.** With no `ML_TRAINER_URL` this returns
 * immediately, which is where the deployment is today: no training service, no
 * artifacts, and a scorer that is never called.
 */

export const ANTICHEAT_RETRAIN_INTERVAL_DAYS = 30;

export interface MlTrainerConfig {
  readonly url: string;
  readonly token?: string;
  readonly timeoutMs: number;
}

export const readMlTrainerConfig = (
  environment: NodeJS.ProcessEnv
): MlTrainerConfig | undefined => {
  const url = environment.ML_TRAINER_URL?.trim();
  if (!url) return undefined;
  const token = environment.ML_TRAINER_TOKEN?.trim();
  const timeoutMs = Number(environment.ML_TRAINER_TIMEOUT_MS ?? 300_000);
  return {
    url,
    ...(token ? { token } : {}),
    // Fitting is minutes of work, not milliseconds. This is a background sweep,
    // so it can afford to wait — but not forever.
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 300_000
  };
};

export type MlTrainerFetch = (
  input: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface TrainedCandidate {
  readonly version: string;
  readonly trainedOnRuns: number;
  readonly flagRate: number;
  readonly metrics: Record<string, unknown>;
}

export interface MlRetrainDeps {
  db: Database;
  trainer?: MlTrainerConfig;
  fetchLike?: MlTrainerFetch;
}

export interface MlRetrainOutcome {
  /** `undefined` when nothing was due or nothing could be fitted. */
  proposed?: { kind: 'anticheat' | 'quest_recommend'; version: string; promotable: boolean };
  reason: 'not_configured' | 'not_due' | 'below_floor' | 'trainer_unavailable' | 'proposed';
}

/** Days since the most recent proposal of this kind, or `Infinity` if never. */
const daysSinceLastProposal = async (
  db: Database,
  kind: 'anticheat' | 'quest_recommend',
  now: Date
): Promise<number> => {
  const rows = await db.query<{ proposed_at: Date }>(
    'SELECT proposed_at FROM ml_models WHERE kind = $1 ORDER BY proposed_at DESC LIMIT 1',
    [kind]
  );
  const last = rows.rows[0]?.proposed_at;
  if (!last) return Number.POSITIVE_INFINITY;
  return (now.getTime() - last.getTime()) / 86_400_000;
};

const liveFlagRate = async (db: Database): Promise<number> => {
  const rows = await db.query<{ total: string; flagged: string }>(
    `SELECT count(*)::text AS total,
       count(*) FILTER (WHERE ml_flagged)::text AS flagged
     FROM ml_run_features`
  );
  const total = Number(rows.rows[0]?.total ?? 0);
  return total === 0 ? 0 : Number(rows.rows[0]?.flagged ?? 0) / total;
};

const requestTraining = async (
  deps: MlRetrainDeps,
  kind: 'anticheat' | 'quest_recommend'
): Promise<TrainedCandidate | undefined> => {
  const trainer = deps.trainer;
  if (!trainer) return undefined;
  const fetchLike = deps.fetchLike ?? (globalThis.fetch as unknown as MlTrainerFetch);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), trainer.timeoutMs);
  try {
    const response = await fetchLike(`${trainer.url.replace(/\/$/, '')}/train`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(trainer.token ? { authorization: `Bearer ${trainer.token}` } : {})
      },
      body: JSON.stringify({ kind }),
      signal: controller.signal
    });
    if (!response.ok) return undefined;
    const body = (await response.json()) as {
      version?: unknown;
      trained_on_runs?: unknown;
      flag_rate?: unknown;
      metrics?: unknown;
    };
    if (typeof body.version !== 'string' || body.version.length === 0) return undefined;
    if (typeof body.trained_on_runs !== 'number') return undefined;
    return {
      version: body.version,
      trainedOnRuns: body.trained_on_runs,
      flagRate: typeof body.flag_rate === 'number' ? body.flag_rate : 0,
      metrics:
        typeof body.metrics === 'object' && body.metrics !== null
          ? (body.metrics as Record<string, unknown>)
          : {}
    };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * The anti-cheat model, monthly.
 *
 * The advice is stored on the row rather than acted on: a reviewer opening the
 * queue sees the flag rate, the baseline, and a sentence about whether the
 * numbers look like a refinement or a change of behaviour.
 */
export const processAnticheatRetrain = async (
  deps: MlRetrainDeps,
  now: Date = new Date()
): Promise<MlRetrainOutcome> => {
  if (!deps.trainer) return { reason: 'not_configured' };
  if ((await daysSinceLastProposal(deps.db, 'anticheat', now)) < ANTICHEAT_RETRAIN_INTERVAL_DAYS)
    return { reason: 'not_due' };

  const counted = await deps.db.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM ml_run_features'
  );
  if (Number(counted.rows[0]?.count ?? 0) < ML_TRAINING_SET_FLOOR) return { reason: 'below_floor' };

  const candidate = await requestTraining(deps, 'anticheat');
  if (!candidate) return { reason: 'trainer_unavailable' };

  const baseline = await liveFlagRate(deps.db);
  const advice = mlPromotionAdvice({
    version: candidate.version,
    flagRate: candidate.flagRate,
    baselineFlagRate: baseline,
    trainedOnRuns: candidate.trainedOnRuns
  });

  await deps.db.query(
    `INSERT INTO ml_models (kind, version, trained_on_runs, flag_rate, baseline_flag_rate,
       metrics, promotion_note)
     VALUES ('anticheat', $1, $2, $3, $4, $5::jsonb, $6)
     ON CONFLICT (kind, version) DO NOTHING`,
    [
      candidate.version,
      candidate.trainedOnRuns,
      candidate.flagRate,
      baseline,
      JSON.stringify({ ...candidate.metrics, promotable: advice.promotable }),
      advice.note
    ]
  );

  return {
    proposed: { kind: 'anticheat', version: candidate.version, promotable: advice.promotable },
    reason: 'proposed'
  };
};

/**
 * The quest recommender, weekly.
 *
 * Gated on the fleet having enough interactions to be worth factorising. Today
 * that gate is closed and will stay closed: nothing writes a quest acceptance
 * or completion, so `quest_interactions` is empty (`045` explains why).
 */
export const processQuestRecommendRetrain = async (
  deps: MlRetrainDeps,
  now: Date = new Date()
): Promise<MlRetrainOutcome> => {
  if (!deps.trainer) return { reason: 'not_configured' };
  if ((await daysSinceLastProposal(deps.db, 'quest_recommend', now)) < QUEST_RETRAIN_INTERVAL_DAYS)
    return { reason: 'not_due' };

  const counted = await deps.db.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM quest_interactions WHERE weight > 0'
  );
  if (!questModelIsWorthFitting(Number(counted.rows[0]?.count ?? 0)))
    return { reason: 'below_floor' };

  const candidate = await requestTraining(deps, 'quest_recommend');
  if (!candidate) return { reason: 'trainer_unavailable' };

  await deps.db.query(
    `INSERT INTO ml_models (kind, version, trained_on_runs, metrics, promotion_note)
     VALUES ('quest_recommend', $1, $2, $3::jsonb, $4)
     ON CONFLICT (kind, version) DO NOTHING`,
    [
      candidate.version,
      candidate.trainedOnRuns,
      JSON.stringify(candidate.metrics),
      'Recommender candidate. A reviewer still has to promote it.'
    ]
  );

  return {
    proposed: { kind: 'quest_recommend', version: candidate.version, promotable: true },
    reason: 'proposed'
  };
};
