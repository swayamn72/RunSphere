import type { RunIntegrityVerdict } from './run-integrity.js';

/**
 * What the anti-cheat model is allowed to do (`ml.md` System 1, "Integration
 * into the Run Submission Pipeline" and "Key Constraints").
 *
 * The model itself lives in Python and is trained offline. This file is the
 * policy around it, and it exists as a pure function for one reason: every
 * constraint `ml.md` calls non-negotiable is a *decision*, not an inference,
 * and a decision that lives inside an HTTP handler is a decision nobody can
 * test.
 *
 * The four that are enforced here:
 *
 *   1. **The model never rejects.** `ml.md`: "Auto-rejection is the exclusive
 *      domain of `run-integrity.ts` hard rules." The strongest outcome this can
 *      return is `hold_for_review`, and the type system makes anything else
 *      unrepresentable.
 *   2. **A model version is pinned to every decision**, so a disputed flag can
 *      be replayed against the model that made it.
 *   3. **Cold start is graceful.** Under the training-set floor there is no
 *      call and no flag — the system behaves exactly as it does today.
 *   4. **An unreachable scorer is not a verdict.** A timeout or a 500 passes
 *      the run. Anything else lets an outage become an accusation.
 */

/** `ml.md` Phase 2 opens at this many labelled runs. */
export const ML_TRAINING_SET_FLOOR = 2_000;

/**
 * `ml.md`: below -0.3 hold for review; -0.3 to 0.0 pass but mark; above 0.0
 * pass normally. More negative is more anomalous.
 */
export const ML_HOLD_THRESHOLD = -0.3;
export const ML_MARK_THRESHOLD = 0;

/**
 * What the pipeline does next. There is no `reject`, and that absence is the
 * whole point — see rule 1 above.
 */
export type MlClaimAction = 'pass' | 'mark_low_confidence' | 'hold_for_review';

export interface MlScore {
  /** `decision_function` output. More negative is more anomalous. */
  readonly confidence: number;
  /** Which artifact produced it, e.g. `anticheat_v2`. */
  readonly modelVersion: string;
}

export interface MlDecision {
  readonly action: MlClaimAction;
  /** Written to `ml_run_features.ml_flagged`. */
  readonly flagged: boolean;
  /** Null when nothing scored the run, so a gap is visible rather than a zero. */
  readonly confidence: number | undefined;
  readonly modelVersion: string | undefined;
  /** Why, in one machine-readable word, for the audit row. */
  readonly reason:
    'scored' | 'cold_start' | 'not_configured' | 'scorer_unavailable' | 'rule_based_rejection';
}

const pass = (reason: MlDecision['reason']): MlDecision => ({
  action: 'pass',
  flagged: false,
  confidence: undefined,
  modelVersion: undefined,
  reason
});

export interface MlDecisionInput {
  /** Absent when nothing scored the run: no model, no service, or a timeout. */
  readonly score?: MlScore;
  /** How many labelled runs the feature store holds. */
  readonly trainingSetSize: number;
  /** False when no ML endpoint is configured for this deployment. */
  readonly configured: boolean;
  /** What the hard rules already decided. */
  readonly ruleVerdict: RunIntegrityVerdict;
  /** Set when the scorer was asked and could not answer. */
  readonly scorerUnavailable?: boolean;
}

/**
 * The decision, from the score and the state of the world.
 *
 * Order matters. A run the hard rules already rejected is never scored: it has
 * no claim to hold, the model would be asked to opine on something already
 * settled, and its answer would end up in the feature store labelled by its own
 * output rather than by the rule that actually decided.
 */
export const mlClaimDecision = (input: MlDecisionInput): MlDecision => {
  if (input.ruleVerdict === 'rejected') return pass('rule_based_rejection');
  if (!input.configured) return pass('not_configured');
  if (input.trainingSetSize < ML_TRAINING_SET_FLOOR) return pass('cold_start');
  // A scorer that did not answer has said nothing. `ml.md` rule 5 makes cold
  // start behave exactly like today, and an outage is the same situation: the
  // alternative is that a deploy of the ML service flags every run in flight.
  if (input.scorerUnavailable || !input.score) return pass('scorer_unavailable');

  const { confidence, modelVersion } = input.score;
  if (confidence < ML_HOLD_THRESHOLD)
    return {
      action: 'hold_for_review',
      flagged: true,
      confidence,
      modelVersion,
      reason: 'scored'
    };
  if (confidence < ML_MARK_THRESHOLD)
    return {
      action: 'mark_low_confidence',
      // Marked, not flagged: `ml_flagged` is what a reviewer's queue reads, and
      // filling it with the middle band would bury the runs that need looking
      // at under the ones that merely scored oddly.
      flagged: false,
      confidence,
      modelVersion,
      reason: 'scored'
    };
  return { action: 'pass', flagged: false, confidence, modelVersion, reason: 'scored' };
};

/**
 * The training label for a run, from what the rules and the staff decided.
 *
 * `ml.md` defines three: `fraud` (a human said so, or a claim was reversed),
 * `suspicious` (a rule-based gate refused it), `legitimate` (accepted and not
 * flagged).
 *
 * **The model's own output is not a label.** A model whose flags become
 * training labels confirms itself: it flags a runner with an unusual stride,
 * that run enters the next training set as fraud, and the following model is
 * more certain about it. Only `staff_review` may write `fraud`, which is why
 * `label_source` exists alongside `label` in the table.
 */
export type MlLabel = 'legitimate' | 'suspicious' | 'fraud';
export type MlLabelSource = 'rule_based' | 'staff_review' | 'model_flag';

export const mlLabelFor = (input: {
  readonly ruleVerdict: RunIntegrityVerdict;
  /** A human has upheld a report against this run. */
  readonly staffUpheld?: boolean;
}): { readonly label: MlLabel; readonly source: MlLabelSource } => {
  if (input.staffUpheld) return { label: 'fraud', source: 'staff_review' };
  if (input.ruleVerdict === 'rejected' || input.ruleVerdict === 'review')
    return { label: 'suspicious', source: 'rule_based' };
  return { label: 'legitimate', source: 'rule_based' };
};

/** Said to a runner whose claim is held. Never names the model or the score. */
export const ML_HELD_MESSAGE =
  'This run is being checked before it claims ground. Nothing is lost — your run is saved, and somebody will look at it.';

/**
 * A proposed model, and whether it may go live.
 *
 * `ml.md` rule 4: "The worker proposes a new model; a staff reviewer promotes
 * it." So this returns a recommendation and a reason, and the promotion itself
 * is a staff action against `ml_models`.
 */
export interface MlModelProposal {
  readonly version: string;
  /** Share of the holdout the candidate flags. */
  readonly flagRate: number;
  /** Share the model in production flags, for comparison. */
  readonly baselineFlagRate: number;
  readonly trainedOnRuns: number;
}

/**
 * How far a candidate's flag rate may drift before it needs an argument.
 *
 * `ml.md`'s worked example is a model that "suddenly flags 30% of legitimate
 * runs". `contamination` is set to 0.03, so roughly 3% is expected; three times
 * that is a change in behaviour rather than a refinement.
 */
export const ML_FLAG_RATE_CEILING = 0.09;

export const mlPromotionAdvice = (
  proposal: MlModelProposal
): { readonly promotable: boolean; readonly note: string } => {
  if (proposal.trainedOnRuns < ML_TRAINING_SET_FLOOR)
    return {
      promotable: false,
      note: `Trained on ${proposal.trainedOnRuns} runs, below the ${ML_TRAINING_SET_FLOOR} floor.`
    };
  if (proposal.flagRate > ML_FLAG_RATE_CEILING)
    return {
      promotable: false,
      note: `Flags ${(proposal.flagRate * 100).toFixed(1)}% of the holdout, above the ${(ML_FLAG_RATE_CEILING * 100).toFixed(0)}% ceiling. A model that flags this much is describing the fleet, not the fraud.`
    };
  return {
    promotable: true,
    note: `Flags ${(proposal.flagRate * 100).toFixed(1)}% against the live model's ${(proposal.baselineFlagRate * 100).toFixed(1)}%. A reviewer still has to promote it.`
  };
};
