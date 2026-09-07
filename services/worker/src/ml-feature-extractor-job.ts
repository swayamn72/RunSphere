import type { Database } from '@runsphere/db';
import {
  extractMlRunFeatures,
  mlLabelFor,
  type MlPoint,
  type RunIntegrityVerdict
} from '@runsphere/domain';

/**
 * Backfills anti-cheat features for runs the claim route never saw
 * (`ml.md` System 1, "Data Pipeline").
 *
 * **Why this exists when the claim route already extracts features.** The claim
 * route only runs when somebody *tries to claim*. Most runs are not claims —
 * a run that never made a loop, a run somebody did not bother submitting for
 * ground, every run recorded before this feature existed. `ml.md` says the
 * model learns from "ALL run outcomes", and a training set built only from
 * attempted claims would teach it that a claim attempt is what normal looks
 * like.
 *
 * **It reads raw traces and writes no coordinates.** The features are scalars
 * (`ml-features.ts`), and the raw trace stays where it was. A run whose trace
 * has already been purged is skipped rather than estimated: `ml.md` keeps the
 * feature store indefinitely and the trace for thirty days, which means the
 * window to extract is thirty days wide and then it is gone.
 */

export interface MlFeatureExtractorDeps {
  db: Database;
}

export interface MlExtractionOutcome {
  scanned: number;
  extracted: number;
  skippedNoTrace: number;
  skippedUnmeasurable: number;
}

/** One sweep's worth. Small, because this runs on the same loop as everything else. */
export const ML_EXTRACTION_BATCH = 25;

interface CandidateRow {
  activity_id: string;
  verdict: string | null;
  upheld: boolean;
}

/**
 * Runs with a trace still on disk and no feature row yet.
 *
 * `run_integrity_flags` carries the rule-based verdict where one was recorded;
 * its absence means the rules found nothing, which is `clean`. The left join is
 * deliberate — an inner one would silently restrict the training set to runs
 * that had already looked odd.
 */
const candidates = async (db: Database, limit: number): Promise<CandidateRow[]> => {
  const rows = await db.query<CandidateRow>(
    `SELECT submission.id AS activity_id,
       flag.verdict,
       EXISTS (
         SELECT 1 FROM territory_trade_flags flagged
         WHERE flagged.review_outcome = 'upheld'
           AND flagged.lineage_id IN (
             SELECT claim.lineage_id FROM territory_claims claim
             WHERE claim.activity_id = submission.id
           )
       ) AS upheld
     FROM activity_submissions submission
     LEFT JOIN run_integrity_flags flag ON flag.activity_id = submission.id
     WHERE submission.deleted_at IS NULL
       AND submission.raw_trace_purged_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM ml_run_features features
         WHERE features.activity_submission_id = submission.id
       )
     ORDER BY submission.created_at
     LIMIT $1`,
    [limit]
  );
  return rows.rows;
};

const pointsFor = async (db: Database, activityId: string): Promise<MlPoint[]> => {
  const chunks = await db.query<{ payload: unknown }>(
    'SELECT payload FROM activity_chunks WHERE activity_id = $1 ORDER BY sequence',
    [activityId]
  );
  return chunks.rows.flatMap((row) => {
    const chunk = row.payload as { points?: unknown };
    if (!Array.isArray(chunk.points)) return [];
    return chunk.points.flatMap((value) => {
      const raw = value as {
        latitude?: unknown;
        longitude?: unknown;
        recordedAt?: unknown;
        accuracyMeters?: unknown;
      };
      if (
        typeof raw.latitude !== 'number' ||
        typeof raw.longitude !== 'number' ||
        typeof raw.recordedAt !== 'string'
      )
        return [];
      const at = new Date(raw.recordedAt);
      if (Number.isNaN(at.getTime())) return [];
      return [
        {
          latitude: raw.latitude,
          longitude: raw.longitude,
          at,
          ...(typeof raw.accuracyMeters === 'number' ? { accuracyMetres: raw.accuracyMeters } : {})
        }
      ];
    });
  });
};

const verdictOf = (row: CandidateRow): RunIntegrityVerdict =>
  row.verdict === 'rejected' ? 'rejected' : row.verdict === 'review' ? 'review' : 'clean';

export const processMlFeatureExtraction = async (
  { db }: MlFeatureExtractorDeps,
  limit: number = ML_EXTRACTION_BATCH
): Promise<MlExtractionOutcome> => {
  const rows = await candidates(db, limit);
  const outcome: MlExtractionOutcome = {
    scanned: rows.length,
    extracted: 0,
    skippedNoTrace: 0,
    skippedUnmeasurable: 0
  };

  for (const row of rows) {
    const points = await pointsFor(db, row.activity_id);
    if (points.length === 0) {
      outcome.skippedNoTrace += 1;
      continue;
    }
    const features = extractMlRunFeatures(points);
    if (!features) {
      // Nothing measurable in it. Skipped rather than stored as zeroes, which
      // would teach the model that a blank trace is normal.
      outcome.skippedUnmeasurable += 1;
      continue;
    }
    const { label, source } = mlLabelFor({
      ruleVerdict: verdictOf(row),
      // A claim reversed by staff is `ml.md`'s second route to a fraud label,
      // and the only one besides a reviewer saying so directly.
      ...(row.upheld ? { staffUpheld: true } : {})
    });

    await db.query(
      `INSERT INTO ml_run_features (activity_submission_id,
         mean_speed_mps, max_speed_mps, speed_variance, p95_speed_mps, speed_skew,
         mean_horizontal_accuracy_m, accuracy_variance, lateral_deviation_m, signal_loss_gaps,
         mean_turn_rate_deg_per_sec, max_turn_rate_deg_per_sec, sharp_turn_count,
         loop_closure_gap_m, loop_area_sqm, loop_perimeter_m, isoperimetric_ratio,
         total_duration_seconds, total_distance_m, accepted_point_fraction, hour_of_day,
         label, label_source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
         $17, $18, $19, $20, $21, $22, $23)
       ON CONFLICT (activity_submission_id) DO NOTHING`,
      [
        row.activity_id,
        features.meanSpeedMps,
        features.maxSpeedMps,
        features.speedVariance,
        features.p95SpeedMps,
        features.speedSkew,
        features.meanHorizontalAccuracyM,
        features.accuracyVariance,
        features.lateralDeviationM,
        features.signalLossGaps,
        features.meanTurnRateDegPerSec,
        features.maxTurnRateDegPerSec,
        features.sharpTurnCount,
        features.loopClosureGapM,
        features.loopAreaSqm,
        features.loopPerimeterM,
        features.isoperimetricRatio,
        features.totalDurationSeconds,
        features.totalDistanceM,
        features.acceptedPointFraction,
        features.hourOfDay,
        label,
        source
      ]
    );
    outcome.extracted += 1;
  }

  return outcome;
};
