import { describe, expect, it, vi } from 'vitest';
import type { MlRunFeatures } from '@runsphere/domain';
import { ML_FEATURE_COLUMNS, ML_TRAINING_SET_FLOOR } from '@runsphere/domain';
import { adviseOnRun, createMlScorer, readMlScorerConfig } from './ml-scoring.js';

const features: MlRunFeatures = {
  meanSpeedMps: 3.2,
  maxSpeedMps: 4.1,
  speedVariance: 0.4,
  p95SpeedMps: 4,
  speedSkew: -0.3,
  meanHorizontalAccuracyM: 9,
  accuracyVariance: 2,
  lateralDeviationM: 1.2,
  signalLossGaps: 0,
  meanTurnRateDegPerSec: 2.1,
  maxTurnRateDegPerSec: 18,
  sharpTurnCount: 4,
  loopClosureGapM: 12,
  loopAreaSqm: 41_000,
  loopPerimeterM: 820,
  isoperimetricRatio: 0.77,
  totalDurationSeconds: 900,
  totalDistanceM: 2_900,
  acceptedPointFraction: 0.98,
  hourOfDay: 6
};

const okResponse = (body: unknown) => ({
  ok: true,
  status: 200,
  json: () => Promise.resolve(body)
});

const database = (count: number) => ({
  query: vi.fn(() => Promise.resolve({ rows: [{ count: String(count) }] }))
});

describe('configuring the scorer', () => {
  it('is unconfigured without a URL, which is the normal state', () => {
    expect(readMlScorerConfig({})).toBeUndefined();
    expect(readMlScorerConfig({ ML_SCORER_URL: '  ' })).toBeUndefined();
  });

  it('keeps the wait short, because a claim is a foreground request', () => {
    expect(readMlScorerConfig({ ML_SCORER_URL: 'http://ml' })?.timeoutMs).toBe(800);
    expect(
      readMlScorerConfig({ ML_SCORER_URL: 'http://ml', ML_SCORER_TIMEOUT_MS: 'nonsense' })
        ?.timeoutMs
    ).toBe(800);
  });
});

describe('what is sent to the scorer', () => {
  it('sends named columns beside the values', async () => {
    // A vector that silently shifted by one column would still score, and
    // would score wrongly for months before anybody noticed.
    const fetchLike = vi.fn(() =>
      Promise.resolve(okResponse({ confidence: 0.2, model_version: 'anticheat_v1' }))
    );
    await createMlScorer({ url: 'http://ml', timeoutMs: 800 }, fetchLike as never)(features);

    const body = JSON.parse(String((fetchLike.mock.calls[0] as never[])[1]['body']));
    expect(body.columns).toEqual(ML_FEATURE_COLUMNS);
    expect(body.values).toHaveLength(ML_FEATURE_COLUMNS.length);
  });

  it('sends no coordinate, because it has none to send', async () => {
    const fetchLike = vi.fn(() =>
      Promise.resolve(okResponse({ confidence: 0.2, model_version: 'v1' }))
    );
    await createMlScorer({ url: 'http://ml', timeoutMs: 800 }, fetchLike as never)(features);

    const raw = String((fetchLike.mock.calls[0] as never[])[1]['body']);
    expect(raw.toLowerCase()).not.toMatch(/latitude|longitude|"at"|coordinates/);
    // And nothing shaped like a decimal degree pair.
    expect(raw).not.toMatch(/-?\d{1,3}\.\d{4,}\s*,\s*-?\d{1,3}\.\d{4,}/);
  });

  it('does not send the hour of day', () => {
    expect(ML_FEATURE_COLUMNS).not.toContain('hourOfDay');
  });
});

describe('what comes back', () => {
  const scorer = (body: unknown, ok = true) =>
    createMlScorer({ url: 'http://ml/', timeoutMs: 50 }, (() =>
      Promise.resolve({ ok, status: ok ? 200 : 500, json: () => Promise.resolve(body) })) as never);

  it('reads a score and its version', async () => {
    await expect(
      scorer({ confidence: -0.5, model_version: 'anticheat_v3' })(features)
    ).resolves.toEqual({ confidence: -0.5, modelVersion: 'anticheat_v3' });
  });

  it('discards a score with no model behind it', async () => {
    // `044` refuses to store a flag without a version, and a score that cannot
    // be replayed is worse than no score (`ml.md` key constraint 3).
    await expect(scorer({ confidence: -0.9 })(features)).resolves.toBeUndefined();
    await expect(
      scorer({ confidence: -0.9, model_version: '' })(features)
    ).resolves.toBeUndefined();
  });

  it('discards a malformed or failed answer', async () => {
    await expect(scorer({ confidence: 'very' })(features)).resolves.toBeUndefined();
    await expect(
      scorer({ confidence: Number.NaN, model_version: 'v1' })(features)
    ).resolves.toBeUndefined();
    await expect(
      scorer({ confidence: 0.1, model_version: 'v1' }, false)(features)
    ).resolves.toBeUndefined();
  });

  it('treats a thrown request as no score, not as an error', async () => {
    const throwing = createMlScorer({ url: 'http://ml', timeoutMs: 10 }, (() =>
      Promise.reject(new Error('ECONNREFUSED'))) as never);

    await expect(throwing(features)).resolves.toBeUndefined();
  });
});

describe('the advisory step as the claim route calls it', () => {
  it('does nothing at all when no scorer is configured', async () => {
    const db = database(50_000);

    const decision = await adviseOnRun({ database: db }, { features, ruleVerdict: 'clean' });

    expect(decision.reason).toBe('not_configured');
    // Not even the count: an unconfigured deployment pays nothing.
    expect(db.query).not.toHaveBeenCalled();
  });

  it('does not call the scorer below the training floor', async () => {
    const scorer = vi.fn();

    const decision = await adviseOnRun(
      { database: database(ML_TRAINING_SET_FLOOR - 1), scorer },
      { features, ruleVerdict: 'clean' }
    );

    expect(decision.reason).toBe('cold_start');
    expect(scorer).not.toHaveBeenCalled();
  });

  it('scores once past the floor', async () => {
    const scorer = vi.fn(() => Promise.resolve({ confidence: -0.8, modelVersion: 'anticheat_v1' }));

    const decision = await adviseOnRun(
      { database: database(ML_TRAINING_SET_FLOOR), scorer },
      { features, ruleVerdict: 'clean' }
    );

    expect(decision).toMatchObject({
      action: 'hold_for_review',
      flagged: true,
      modelVersion: 'anticheat_v1'
    });
  });

  it('passes the run when the scorer cannot answer', async () => {
    // An outage must not become an accusation.
    const decision = await adviseOnRun(
      { database: database(50_000), scorer: vi.fn(() => Promise.resolve(undefined)) },
      { features, ruleVerdict: 'clean' }
    );

    expect(decision).toMatchObject({ action: 'pass', reason: 'scorer_unavailable' });
  });

  it('never scores a run the hard rules already rejected', async () => {
    const scorer = vi.fn();
    const db = database(50_000);

    const decision = await adviseOnRun(
      { database: db, scorer },
      { features, ruleVerdict: 'rejected' }
    );

    expect(decision.reason).toBe('rule_based_rejection');
    expect(scorer).not.toHaveBeenCalled();
    expect(db.query).not.toHaveBeenCalled();
  });

  it('passes when there were no features to score', async () => {
    const scorer = vi.fn();

    const decision = await adviseOnRun(
      { database: database(50_000), scorer },
      { features: undefined, ruleVerdict: 'clean' }
    );

    expect(decision.action).toBe('pass');
    expect(scorer).not.toHaveBeenCalled();
  });
});
