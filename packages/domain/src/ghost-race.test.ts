import { describe, expect, it } from 'vitest';
import {
  GHOST_MIN_POINTS,
  GHOST_PRIVACY_NOTE,
  GHOST_RULES_NOTE,
  GHOST_TRIM_METRES,
  GHOST_UNAVAILABLE_MESSAGE,
  GHOST_VIEWS_PER_HOUR,
  ghostComparison,
  ghostDistanceAt,
  ghostPositionAt,
  ghostSecondsAtDistance,
  ghostTraceFrom,
  type GhostTrace
} from './ghost-race.js';
import { EARTH_RADIUS_METRES, type ClaimPoint } from './territory-claim.js';

const BASE_LAT = 19.028;
const BASE_LNG = 72.838;
const START = Date.UTC(2026, 8, 6, 5, 0, 0);

/**
 * Metres of latitude, as degrees, on the same sphere `haversineMetres` uses.
 *
 * Derived from `EARTH_RADIUS_METRES` rather than written as 111,320, so the
 * expectations below are exact: a pure latitude step of `northMetres(120)`
 * really is 120 m to the code under test, and the trim lands where the
 * arithmetic in the comments says it does.
 */
const METRES_PER_DEGREE = (EARTH_RADIUS_METRES * Math.PI) / 180;
const northMetres = (metres: number): number => metres / METRES_PER_DEGREE;

/**
 * A straight run north, one point every `stepMetres`, at a steady pace.
 *
 * Straight rather than a loop because every property under test here is about
 * distance along a trace and time at a point — and a straight line makes the
 * expected numbers arithmetic a reader can check.
 */
const straightRun = (options: {
  points: number;
  stepMetres: number;
  secondsPerStep: number;
}): ClaimPoint[] =>
  Array.from({ length: options.points }, (_unused, index) => ({
    latitude: BASE_LAT + northMetres(index * options.stepMetres),
    longitude: BASE_LNG,
    at: new Date(START + index * options.secondsPerStep * 1000)
  }));

const window = (points: readonly ClaimPoint[]) => ({
  startedAt: points[0]!.at,
  finishedAt: points[points.length - 1]!.at
});

/**
 * A 1,200 m trace at 120 m per point, 20 s per point: 6 m/s throughout.
 *
 * 120 m steps on purpose. With 100 m steps the cumulative distance lands on
 * exactly 200 m — the trim boundary — and which side of it a floating-point
 * comparison falls on decides the answer. A real trace never sits on the
 * boundary, so a fixture that does would be testing arithmetic noise.
 *
 * Trimmed, this keeps the points at 240 m to 960 m: 720 m over 120 s.
 */
const evenRun = straightRun({ points: 11, stepMetres: 120, secondsPerStep: 20 });

const traceOf = (points: readonly ClaimPoint[], trim = GHOST_TRIM_METRES): GhostTrace => {
  const result = ghostTraceFrom(points, window(points), trim);
  if ('refusal' in result) throw new Error(`expected a trace, got ${result.refusal}`);
  return result.trace;
};

describe('building a ghost trace', () => {
  it('trims 200 m from each end and rebases the clock', () => {
    const trace = traceOf(evenRun);

    // 1,200 m becomes 720 m: trimmed to the first and last point at least
    // 200 m from each end, which are the ones at 240 m and 960 m.
    expect(trace.distanceMetres).toBeCloseTo(720, 3);
    // At 6 m/s that is 120 s, and the first kept point reads zero.
    expect(trace.durationSeconds).toBe(120);
    expect(trace.points[0]?.elapsedSeconds).toBe(0);
    expect(trace.trimMetres).toBe(GHOST_TRIM_METRES);
  });

  it('keeps the point that crosses the trim rather than the one before it', () => {
    const trace = traceOf(evenRun);

    // The first point at or beyond 200 m is the one at 240 m, not the one at
    // 120 m — keeping the earlier one would leave part of the trimmed arc in.
    expect(trace.points[0]?.latitude).toBeCloseTo(BASE_LAT + northMetres(240), 9);
    expect(trace.points.at(-1)?.latitude).toBeCloseTo(BASE_LAT + northMetres(960), 9);
  });

  it('refuses a loop with nothing left after trimming', () => {
    // 300 m total: the two 200 m trims overlap, and any surviving arc would be
    // exactly the part the trim exists to hide.
    const short = straightRun({ points: 7, stepMetres: 50, secondsPerStep: 10 });

    expect(ghostTraceFrom(short, window(short))).toEqual({ refusal: 'too_short_to_trim' });
  });

  it('refuses a trace of exactly twice the trim, rather than serving a single point', () => {
    const exact = straightRun({ points: 9, stepMetres: 50, secondsPerStep: 10 });

    expect(ghostTraceFrom(exact, window(exact))).toEqual({ refusal: 'too_short_to_trim' });
  });

  it('refuses a trace with too few points to pace against', () => {
    const sparse: ClaimPoint[] = [
      { latitude: BASE_LAT, longitude: BASE_LNG, at: new Date(START) },
      {
        latitude: BASE_LAT + northMetres(1_000),
        longitude: BASE_LNG,
        at: new Date(START + 200_000)
      }
    ];

    expect(ghostTraceFrom(sparse, window(sparse))).toEqual({ refusal: 'too_few_points' });
    expect(GHOST_MIN_POINTS).toBe(4);
  });

  it('uses only the loop the claim was decided on, not the whole run', () => {
    // A warm-up, then the loop, then a cool-down. The claim's window covers
    // only the middle, and a ghost of the warm-up would be a route nobody is
    // contesting — and one that starts at the runner's door.
    const whole = straightRun({ points: 21, stepMetres: 120, secondsPerStep: 20 });
    const loop = { startedAt: whole[5]!.at, finishedAt: whole[15]!.at };

    const result = ghostTraceFrom(whole, loop);
    if ('refusal' in result) throw new Error(result.refusal);

    // The loop runs from 600 m to 1,800 m into the whole run. Trimmed it is
    // 720 m starting 840 m in — not 240 m, which is where a ghost of the
    // whole run would have started.
    expect(result.trace.distanceMetres).toBeCloseTo(720, 3);
    expect(result.trace.points[0]?.latitude).toBeCloseTo(BASE_LAT + northMetres(840), 9);
  });

  it('ignores points with unusable coordinates or times', () => {
    const withJunk: ClaimPoint[] = [
      ...evenRun.slice(0, 5),
      { latitude: Number.NaN, longitude: BASE_LNG, at: new Date(START + 100_000) },
      { latitude: BASE_LAT, longitude: BASE_LNG, at: new Date(Number.NaN) },
      ...evenRun.slice(5)
    ];

    const result = ghostTraceFrom(withJunk, window(evenRun));
    if ('refusal' in result) throw new Error(result.refusal);
    expect(result.trace.points.every((point) => Number.isFinite(point.latitude))).toBe(true);
  });

  it('has words for every refusal, so a screen never shows a code', () => {
    for (const refusal of ['too_few_points', 'too_short_to_trim', 'no_duration'] as const) {
      expect(GHOST_UNAVAILABLE_MESSAGE[refusal]).toMatch(/\S/);
    }
  });
});

describe('where the ghost is', () => {
  it('interpolates between points rather than jumping to the nearest', () => {
    const trace = traceOf(evenRun);
    // Ten seconds in, halfway between the 240 m point and the 360 m one.
    const at = ghostPositionAt(trace, 10);

    expect(at?.latitude).toBeCloseTo(BASE_LAT + northMetres(300), 9);
  });

  it('sits at the start before the run begins and stops at the end', () => {
    const trace = traceOf(evenRun);

    expect(ghostPositionAt(trace, -30)?.latitude).toBeCloseTo(trace.points[0]!.latitude, 9);
    // Past the end it stops rather than looping: it is a record of one run.
    expect(ghostPositionAt(trace, 9_999)?.latitude).toBeCloseTo(trace.points.at(-1)!.latitude, 9);
  });

  it('reports how far it has covered', () => {
    const trace = traceOf(evenRun);

    expect(ghostDistanceAt(trace, 0)).toBeCloseTo(0, 3);
    // 6 m/s for 60 s.
    expect(ghostDistanceAt(trace, 60)).toBeCloseTo(360, 3);
    // Never beyond the trace it was built from.
    expect(ghostDistanceAt(trace, 9_999)).toBeLessThanOrEqual(trace.distanceMetres + 0.001);
  });

  it('says how long the ghost took to reach a distance', () => {
    const trace = traceOf(evenRun);

    expect(ghostSecondsAtDistance(trace, 0)).toBe(0);
    expect(ghostSecondsAtDistance(trace, 360)).toBeCloseTo(60, 3);
    expect(ghostSecondsAtDistance(trace, 10_000)).toBe(trace.durationSeconds);
  });
});

describe('who is ahead', () => {
  const trace = traceOf(evenRun);

  it('compares distance covered, not elapsed time', () => {
    // Both clocks start together, so comparing them is always a tie. What
    // differs is how far each has got in that time.
    //
    // 60 s in, the ghost has covered 360 m. A runner who has covered 480 m in
    // the same 60 s is ahead by the 20 s the ghost needed for that extra 120 m.
    const ahead = ghostComparison(trace, 60, 480);

    expect(ahead.standing).toBe('ahead');
    expect(ahead.secondsAhead).toBe(20);
    expect(ahead.message).toBe('You are 20 seconds ahead.');
  });

  it('reports being behind without blaming anybody', () => {
    const behind = ghostComparison(trace, 60, 240);

    expect(behind.standing).toBe('behind');
    expect(behind.secondsAhead).toBe(-20);
    expect(behind.message).toBe('You are 20 seconds behind.');
  });

  it('calls a small gap level rather than flickering between ahead and behind', () => {
    // Within five seconds is GPS noise, not a lead. At 6 m/s that is 30 m.
    expect(ghostComparison(trace, 60, 360).standing).toBe('level');
    expect(ghostComparison(trace, 60, 384).standing).toBe('level');
    expect(ghostComparison(trace, 60, 336).standing).toBe('level');
  });

  it('says the ghost route is done rather than growing a number forever', () => {
    const finished = ghostComparison(trace, 100, trace.distanceMetres + 500);

    expect(finished.standing).toBe('ghost_finished');
    expect(finished.message).toContain('whole ghost route');
  });

  it('reads as a sentence, because somebody reads it mid-run', () => {
    // The smallest gap that is not "level" is six seconds, so in practice the
    // message is always plural. `plural` keeps the singular anyway, for
    // whoever lowers `GHOST_LEVEL_SECONDS` later.
    expect(ghostComparison(trace, 60, 396).message).toMatch(/^You are \d+ seconds ahead\.$/);
    expect(ghostComparison(trace, 60, 324).message).toMatch(/^You are \d+ seconds behind\.$/);
  });
});

describe('what a runner is told', () => {
  it('states the trim in metres rather than calling it private', () => {
    expect(GHOST_PRIVACY_NOTE).toContain('200 m');
    expect(GHOST_PRIVACY_NOTE).toContain('both ends');
  });

  it('says a ghost changes no rule', () => {
    // `territory-guide.md`: "Ghost Race is purely a motivational UI layer —
    // the contest rules are identical."
    expect(GHOST_RULES_NOTE).toContain('changes nothing');
  });

  it('publishes the hourly budget the endpoint enforces', () => {
    expect(GHOST_VIEWS_PER_HOUR).toBe(3);
  });
});
