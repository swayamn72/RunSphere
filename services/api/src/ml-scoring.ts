import type { Database } from '@runsphere/db';
import {
  ML_FEATURE_COLUMNS,
  ML_TRAINING_SET_FLOOR,
  mlClaimDecision,
  mlFeatureVector,
  type MlDecision,
  type MlRunFeatures,
  type MlScore
} from '@runsphere/domain';
import type { RunIntegrityVerdict } from '@runsphere/domain';

/**
 * Talking to the anti-cheat scorer (`ml.md` System 1, Phase 3).
 *
 * The model is a Python service (`services/ml`). This is everything on the
 * TypeScript side of that boundary, and it is written around one idea: **the
 * scorer is advisory, so nothing about it may ever be load-bearing.**
 *
 *   * Unconfigured is normal. No `ML_SCORER_URL` means no call, and a claim
 *     goes through exactly as it does today — the same treatment FCM, email,
 *     and the geocoder get.
 *   * A timeout is not a verdict. `mlClaimDecision` turns an unreachable
 *     scorer into a pass, because the alternative is that restarting the ML
 *     service flags every run in flight.
 *   * The trace never leaves. What is posted is nineteen numbers in a fixed
 *     order (`ML_FEATURE_COLUMNS`); the scorer has no way to learn where
 *     anybody ran, because it is never told.
 */

export interface MlScorerConfig {
  readonly url: string;
  /** Sent as a bearer token when the deployment sets one. */
  readonly token?: string;
  readonly timeoutMs: number;
}

/**
 * All or nothing, like every other provider here. A URL with no reachable
 * service behind it is worse than no URL: it adds a timeout to every claim.
 */
export const readMlScorerConfig = (environment: NodeJS.ProcessEnv): MlScorerConfig | undefined => {
  const url = environment.ML_SCORER_URL?.trim();
  if (!url) return undefined;
  const token = environment.ML_SCORER_TOKEN?.trim();
  const timeoutMs = Number(environment.ML_SCORER_TIMEOUT_MS ?? 800);
  return {
    url,
    ...(token ? { token } : {}),
    // A claim submission is a foreground request. The model is worth under a
    // second of somebody's wait and not a millisecond more.
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 800
  };
};

export type MlFetchLike = (
  input: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  }
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export type MlScorer = (features: MlRunFeatures) => Promise<MlScore | undefined>;

/**
 * Posts the feature vector and reads a score back.
 *
 * Returns `undefined` for every failure — a non-200, a malformed body, a
 * timeout, a DNS error. The caller cannot tell them apart and should not: all
 * of them mean "nothing scored this run", and `mlClaimDecision` handles that
 * one way.
 */
export const createMlScorer = (
  config: MlScorerConfig,
  fetchLike: MlFetchLike = globalThis.fetch as unknown as MlFetchLike
): MlScorer => {
  return async (features) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const response = await fetchLike(`${config.url.replace(/\/$/, '')}/score`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(config.token ? { authorization: `Bearer ${config.token}` } : {})
        },
        // Named columns rather than a bare array: a vector that silently
        // shifted by one column would still score, and would score wrongly.
        body: JSON.stringify({
          columns: ML_FEATURE_COLUMNS,
          values: mlFeatureVector(features)
        }),
        signal: controller.signal
      });
      if (!response.ok) return undefined;
      const body = (await response.json()) as {
        confidence?: unknown;
        model_version?: unknown;
      };
      if (typeof body.confidence !== 'number' || !Number.isFinite(body.confidence))
        return undefined;
      // A score with no version behind it cannot be replayed, and `044` will
      // refuse to store a flag without one. Better to have no score.
      if (typeof body.model_version !== 'string' || body.model_version.length === 0)
        return undefined;
      return { confidence: body.confidence, modelVersion: body.model_version };
    } catch {
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  };
};

/**
 * How many labelled runs the feature store holds.
 *
 * Read per claim, which sounds wasteful and is not: it is one indexed count,
 * and caching it would mean the cold-start gate opened at a moment nobody could
 * reconstruct afterwards. Once past the floor the answer stops mattering.
 */
export const trainingSetSize = async (database: Pick<Database, 'query'>): Promise<number> => {
  const counted = await database.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM ml_run_features'
  );
  return Number(counted.rows[0]?.count ?? 0);
};

export interface MlAdviceDeps {
  readonly database: Pick<Database, 'query'>;
  readonly scorer?: MlScorer;
}

/**
 * The whole advisory step, as one call the claim route can make.
 *
 * Everything expensive is behind a gate: with no scorer configured this does
 * nothing at all, and below the training floor it does one count.
 */
export const adviseOnRun = async (
  deps: MlAdviceDeps,
  input: {
    readonly features: MlRunFeatures | undefined;
    readonly ruleVerdict: RunIntegrityVerdict;
  }
): Promise<MlDecision> => {
  if (input.ruleVerdict === 'rejected' || !deps.scorer || !input.features)
    return mlClaimDecision({
      trainingSetSize: 0,
      configured: Boolean(deps.scorer),
      ruleVerdict: input.ruleVerdict
    });

  const size = await trainingSetSize(deps.database);
  if (size < ML_TRAINING_SET_FLOOR)
    return mlClaimDecision({
      trainingSetSize: size,
      configured: true,
      ruleVerdict: input.ruleVerdict
    });

  const score = await deps.scorer(input.features);
  return mlClaimDecision({
    ...(score ? { score } : {}),
    trainingSetSize: size,
    configured: true,
    ruleVerdict: input.ruleVerdict,
    scorerUnavailable: !score
  });
};
