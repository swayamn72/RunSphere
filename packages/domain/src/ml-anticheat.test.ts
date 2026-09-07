import { describe, expect, it } from 'vitest';
import {
  ML_FLAG_RATE_CEILING,
  ML_HELD_MESSAGE,
  ML_HOLD_THRESHOLD,
  ML_TRAINING_SET_FLOOR,
  mlClaimDecision,
  mlLabelFor,
  mlPromotionAdvice,
  type MlDecisionInput
} from './ml-anticheat.js';

const input = (overrides: Partial<MlDecisionInput> = {}): MlDecisionInput => ({
  score: { confidence: 0.4, modelVersion: 'anticheat_v1' },
  trainingSetSize: 5_000,
  configured: true,
  ruleVerdict: 'clean',
  ...overrides
});

describe('the model never rejects a run', () => {
  it('holds for review at its most severe, however anomalous the score', () => {
    // `ml.md` key constraint 1: "Auto-rejection is the exclusive domain of
    // run-integrity.ts hard rules."
    for (const confidence of [-0.31, -1, -50, -1e6]) {
      const decision = mlClaimDecision(
        input({ score: { confidence, modelVersion: 'anticheat_v1' } })
      );
      expect(decision.action).toBe('hold_for_review');
      // There is no `reject` in the union at all — this asserts the outcome of
      // that, so a widened union would fail here too.
      expect(['pass', 'mark_low_confidence', 'hold_for_review']).toContain(decision.action);
    }
  });

  it('leaves a rule-based rejection alone rather than scoring it', () => {
    // The hard rules already decided. Scoring it would put the model's opinion
    // in the feature store next to a label the model did not produce.
    const decision = mlClaimDecision(input({ ruleVerdict: 'rejected' }));

    expect(decision.reason).toBe('rule_based_rejection');
    expect(decision.confidence).toBeUndefined();
    expect(decision.flagged).toBe(false);
  });

  it('tells a held runner nothing is lost, and names no model', () => {
    expect(ML_HELD_MESSAGE).toContain('your run is saved');
    expect(ML_HELD_MESSAGE.toLowerCase()).not.toMatch(/model|score|anomal|confidence/);
  });
});

describe('the three bands ml.md specifies', () => {
  it('holds below -0.3', () => {
    expect(
      mlClaimDecision(input({ score: { confidence: -0.31, modelVersion: 'v1' } })).action
    ).toBe('hold_for_review');
    expect(ML_HOLD_THRESHOLD).toBe(-0.3);
  });

  it('marks between -0.3 and 0, without filling the review queue', () => {
    const decision = mlClaimDecision(input({ score: { confidence: -0.1, modelVersion: 'v1' } }));

    expect(decision.action).toBe('mark_low_confidence');
    // `ml_flagged` is what a reviewer's queue reads. Filling it with the middle
    // band buries the runs that actually need looking at.
    expect(decision.flagged).toBe(false);
  });

  it('passes above 0', () => {
    expect(mlClaimDecision(input({ score: { confidence: 0.01, modelVersion: 'v1' } })).action).toBe(
      'pass'
    );
  });

  it('treats exactly -0.3 as the top of the hold band, not the bottom', () => {
    // A boundary has to fall somewhere, and the softer side is the right one
    // for a check that stops somebody claiming ground.
    expect(mlClaimDecision(input({ score: { confidence: -0.3, modelVersion: 'v1' } })).action).toBe(
      'mark_low_confidence'
    );
  });

  it('pins the model version to every scored decision', () => {
    // `ml.md` key constraint 3: a disputed flag must be replayable against the
    // model that made it.
    const decision = mlClaimDecision(
      input({ score: { confidence: -0.9, modelVersion: 'anticheat_v7' } })
    );

    expect(decision.modelVersion).toBe('anticheat_v7');
  });
});

describe('when there is no model to ask', () => {
  it('behaves exactly as today below the training-set floor', () => {
    // `ml.md` key constraint 5: "Before Phase 2 (2,000+ runs), the system
    // behaves identically to today."
    const decision = mlClaimDecision(input({ trainingSetSize: ML_TRAINING_SET_FLOOR - 1 }));

    expect(decision).toMatchObject({ action: 'pass', flagged: false, reason: 'cold_start' });
    expect(decision.confidence).toBeUndefined();
  });

  it('opens at the floor exactly', () => {
    expect(mlClaimDecision(input({ trainingSetSize: ML_TRAINING_SET_FLOOR })).reason).toBe(
      'scored'
    );
  });

  it('passes when no ML service is configured for this deployment', () => {
    expect(mlClaimDecision(input({ configured: false })).reason).toBe('not_configured');
  });

  it('passes when the scorer could not answer', () => {
    // An outage must not become an accusation: a deploy of the ML service
    // would otherwise flag every run in flight.
    expect(mlClaimDecision(input({ scorerUnavailable: true })).reason).toBe('scorer_unavailable');
    const missing = input();
    delete (missing as { score?: unknown }).score;
    expect(mlClaimDecision(missing).reason).toBe('scorer_unavailable');
  });

  it('checks the rule verdict before anything else', () => {
    // A rejected run is settled whether or not the service is up.
    expect(
      mlClaimDecision(input({ ruleVerdict: 'rejected', configured: false, trainingSetSize: 0 }))
        .reason
    ).toBe('rule_based_rejection');
  });
});

describe('labelling the training set', () => {
  it('labels a clean run legitimate', () => {
    expect(mlLabelFor({ ruleVerdict: 'clean' })).toEqual({
      label: 'legitimate',
      source: 'rule_based'
    });
  });

  it('labels anything the rules refused or questioned as suspicious', () => {
    expect(mlLabelFor({ ruleVerdict: 'rejected' }).label).toBe('suspicious');
    expect(mlLabelFor({ ruleVerdict: 'review' }).label).toBe('suspicious');
  });

  it('lets only a human write fraud', () => {
    // A model whose own flags become training labels confirms itself: it flags
    // an unusual stride, that run enters the next training set as fraud, and
    // the next model is more certain about it.
    expect(mlLabelFor({ ruleVerdict: 'clean', staffUpheld: true })).toEqual({
      label: 'fraud',
      source: 'staff_review'
    });
    expect(mlLabelFor({ ruleVerdict: 'rejected' }).source).not.toBe('model_flag');
  });
});

describe('promoting a retrained model', () => {
  const proposal = {
    version: 'anticheat_v2',
    flagRate: 0.031,
    baselineFlagRate: 0.029,
    trainedOnRuns: 12_000
  };

  it('recommends a candidate that behaves like the one it replaces', () => {
    const advice = mlPromotionAdvice(proposal);

    expect(advice.promotable).toBe(true);
    // Even then it is only a recommendation: `ml.md` key constraint 4 requires
    // a person to promote.
    expect(advice.note).toContain('reviewer still has to promote it');
  });

  it('refuses a candidate that suddenly flags a large share of runs', () => {
    // `ml.md`'s worked example: "a degrading model that suddenly flags 30% of
    // legitimate runs must be caught before it goes live".
    const advice = mlPromotionAdvice({ ...proposal, flagRate: 0.3 });

    expect(advice.promotable).toBe(false);
    expect(advice.note).toContain('describing the fleet, not the fraud');
    expect(ML_FLAG_RATE_CEILING).toBeLessThan(0.3);
  });

  it('refuses a candidate trained on too little', () => {
    const advice = mlPromotionAdvice({ ...proposal, trainedOnRuns: 500 });

    expect(advice.promotable).toBe(false);
    expect(advice.note).toContain('below the 2000 floor');
  });
});
