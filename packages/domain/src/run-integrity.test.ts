import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RUN_INTEGRITY_RULE,
  RUN_INTEGRITY_MESSAGE,
  assessRunIntegrity
} from './run-integrity.js';
import type { ClaimPoint } from './territory-claim.js';

const BASE_LAT = 19.076;
const BASE_LNG = 72.8777;
const METRES_PER_DEGREE = 111_320;

/** A straight run north at a steady pace, one fix per `stepSeconds`. */
const steadyRun = (
  speedMps: number,
  count = 60,
  stepSeconds = 5,
  options: { jitter?: number } = {}
): ClaimPoint[] => {
  const jitter = options.jitter ?? 0;
  const start = Date.UTC(2026, 8, 6, 5, 0, 0);
  return Array.from({ length: count }, (_unused, index) => ({
    latitude: BASE_LAT + (index * speedMps * stepSeconds) / METRES_PER_DEGREE,
    // A little side-to-side, the way a person actually moves.
    longitude: BASE_LNG + (index % 2 === 0 ? jitter : -jitter),
    at: new Date(start + index * stepSeconds * 1000)
  }));
};

describe('an ordinary run', () => {
  it('passes at a normal running pace', () => {
    // 3 m/s is about a 5:30/km pace.
    const assessment = assessRunIntegrity(steadyRun(3, 60, 5, { jitter: 0.00002 }));

    expect(assessment.verdict).toBe('clean');
    expect(assessment.findings).toEqual([]);
    expect(assessment.averageSpeedMps).toBeGreaterThan(2.5);
  });

  it('passes for a fast club runner', () => {
    // 5 m/s is roughly a 3:20/km pace — quicker than almost anybody, and
    // still not something the system should refuse.
    expect(assessRunIntegrity(steadyRun(5, 60, 5, { jitter: 0.00002 })).verdict).toBe('clean');
  });

  it('says nothing about a trace too short to judge', () => {
    expect(assessRunIntegrity([]).verdict).toBe('clean');
    expect(assessRunIntegrity(steadyRun(3, 1)).verdict).toBe('clean');
  });
});

describe('traces that are not a person running', () => {
  it('rejects a speed no runner reaches', () => {
    const assessment = assessRunIntegrity(steadyRun(20, 20, 5));

    expect(assessment.findings).toContain('impossible_speed');
    expect(assessment.verdict).toBe('rejected');
  });

  it('rejects a teleport between fixes', () => {
    const points = steadyRun(3, 10, 5, { jitter: 0.00002 });
    points.push({
      latitude: BASE_LAT + 5,
      longitude: BASE_LNG,
      at: new Date(points[points.length - 1]!.at.getTime() + 2000)
    });

    const assessment = assessRunIntegrity(points);
    expect(assessment.findings).toContain('teleport');
    expect(assessment.verdict).toBe('rejected');
  });

  it('rejects a jump with no time between fixes at all', () => {
    const at = new Date(Date.UTC(2026, 8, 6, 5, 0, 0));
    const points: ClaimPoint[] = [
      { latitude: BASE_LAT, longitude: BASE_LNG, at },
      { latitude: BASE_LAT + 1, longitude: BASE_LNG, at }
    ];

    // Dividing by zero seconds would give Infinity rather than a finding, so
    // the distance alone has to decide this one.
    expect(assessRunIntegrity(points).findings).toContain('teleport');
  });

  it('rejects a long stretch too straight to have been run', () => {
    // Two kilometres with no deviation at all: streets bend and people weave.
    const assessment = assessRunIntegrity(steadyRun(4, 100, 5));

    expect(assessment.findings).toContain('unnaturally_straight');
    expect(assessment.verdict).toBe('rejected');
  });

  it('does not call a short straight stretch suspicious', () => {
    // A 300 m straight is a road, not a signature.
    const assessment = assessRunIntegrity(steadyRun(3, 20, 5));

    expect(assessment.findings).not.toContain('unnaturally_straight');
  });
});

describe('traces that only look odd', () => {
  it('flags a vehicle-like average for review rather than refusing outright', () => {
    // 8 m/s sustained is a bicycle, but it is not physically impossible, and a
    // wrong call here takes ground off somebody honest.
    const assessment = assessRunIntegrity(steadyRun(8, 30, 5, { jitter: 0.00005 }));

    expect(assessment.findings).toContain('vehicle_like_pace');
    expect(assessment.verdict).toBe('review');
  });

  it('flags impossible acceleration for review', () => {
    const points = steadyRun(2, 10, 5, { jitter: 0.00002 });
    const last = points[points.length - 1]!;
    // 11 m in one second: 11 m/s, which is under the 12.5 ceiling, but a jump
    // of 9 m/s in a single second is 9 m/s² and no runner does that.
    points.push({
      latitude: last.latitude + 11 / METRES_PER_DEGREE,
      longitude: last.longitude,
      at: new Date(last.at.getTime() + 1_000)
    });

    const assessment = assessRunIntegrity(points);
    expect(assessment.findings).toContain('impossible_acceleration');
    expect(assessment.verdict).toBe('review');
  });

  it('notices a run that never moved', () => {
    const at = Date.UTC(2026, 8, 6, 5, 0, 0);
    const still: ClaimPoint[] = Array.from({ length: 10 }, (_unused, index) => ({
      latitude: BASE_LAT,
      longitude: BASE_LNG,
      at: new Date(at + index * 5000)
    }));

    expect(assessRunIntegrity(still).findings).toContain('no_movement');
  });
});

describe('what the system does with a finding', () => {
  it('never accuses, because bad GPS looks the same as cheating', () => {
    for (const message of Object.values(RUN_INTEGRITY_MESSAGE)) {
      expect(message).not.toMatch(/cheat|fraud|ban|suspend|liar|fake/i);
    }
    // The run is still the runner's, whatever the map decides.
    expect(RUN_INTEGRITY_MESSAGE.impossible_speed).toContain('run itself is still saved');
  });

  it('reports the numbers a reviewer needs, not just a label', () => {
    const assessment = assessRunIntegrity(steadyRun(8, 30, 5, { jitter: 0.00005 }));

    expect(assessment.peakSpeedMps).toBeGreaterThan(0);
    expect(assessment.distanceMetres).toBeGreaterThan(0);
    expect(assessment.straightness).toBeGreaterThanOrEqual(0);
  });

  it('publishes its thresholds rather than hiding them in the code', () => {
    expect(DEFAULT_RUN_INTEGRITY_RULE.maxSpeedMps).toBeGreaterThan(10.4);
    expect(DEFAULT_RUN_INTEGRITY_RULE.maxSustainedSpeedMps).toBeGreaterThan(5.7);
  });
});
