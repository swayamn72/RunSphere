import { describe, expect, it } from 'vitest';
import {
  CLAIM_REFUSAL_MESSAGE,
  canonicaliseRing,
  DEFAULT_CLAIM_RULE,
  claimOutcome,
  detectLoopClaim,
  haversineMetres,
  overlapRatio,
  pointInRing,
  ringAreaSqm,
  ringCentroid,
  type ClaimPoint,
  type ClaimRing,
  type HeldClaim
} from './territory-claim.js';

/**
 * A square loop around a city block, given as trace points.
 *
 * `metres` is the side length; the walk goes anticlockwise from the
 * south-west corner and returns to it, one point every `stepSeconds`.
 */
const BASE_LAT = 19.076;
const BASE_LNG = 72.8777;
const METRES_PER_DEGREE_LAT = 111_320;
const metresPerDegreeLng = (latitude: number): number =>
  METRES_PER_DEGREE_LAT * Math.cos((latitude * Math.PI) / 180);

const squareLoop = (
  metres: number,
  totalSeconds: number,
  options: { originLat?: number; originLng?: number; perSide?: number; close?: boolean } = {}
): ClaimPoint[] => {
  const originLat = options.originLat ?? BASE_LAT;
  const originLng = options.originLng ?? BASE_LNG;
  const perSide = options.perSide ?? 6;
  const dLat = metres / METRES_PER_DEGREE_LAT;
  const dLng = metres / metresPerDegreeLng(originLat);
  const corners: (readonly [number, number])[] = [
    [originLng, originLat],
    [originLng + dLng, originLat],
    [originLng + dLng, originLat + dLat],
    [originLng, originLat + dLat]
  ];

  const path: (readonly [number, number])[] = [];
  for (let side = 0; side < 4; side += 1) {
    const from = corners[side]!;
    const to = corners[(side + 1) % 4]!;
    for (let step = 0; step < perSide; step += 1) {
      const t = step / perSide;
      path.push([from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t]);
    }
  }
  if (options.close !== false) path.push(corners[0]!);

  const start = Date.UTC(2026, 8, 6, 5, 0, 0);
  const gap = (totalSeconds * 1000) / Math.max(1, path.length - 1);
  return path.map(([longitude, latitude], index) => ({
    longitude,
    latitude,
    at: new Date(start + index * gap)
  }));
};

const ringOf = (points: readonly ClaimPoint[]): ClaimRing =>
  points.map((point) => [point.longitude, point.latitude] as const);

describe('the geometry the game is scored on', () => {
  it('measures a 300 metre square as about nine hectares', () => {
    const ring = ringOf(squareLoop(300, 600, { close: false }));

    // 300m x 300m = 90,000 m². Within 2% is ample for a game boundary.
    expect(ringAreaSqm(ring)).toBeGreaterThan(88_000);
    expect(ringAreaSqm(ring)).toBeLessThan(92_000);
  });

  it('gives the same area whichever way round the loop was run', () => {
    const ring = ringOf(squareLoop(300, 600, { close: false }));
    const reversed = [...ring].reverse();

    // Which way somebody went around the block is not a rule anybody expects.
    expect(ringAreaSqm(reversed)).toBeCloseTo(ringAreaSqm(ring), 0);
  });

  it('puts the centroid in the middle of the block', () => {
    const ring = ringOf(squareLoop(300, 600, { close: false }));
    const [lng, lat] = ringCentroid(ring);

    expect(lat).toBeGreaterThan(BASE_LAT);
    expect(lng).toBeGreaterThan(BASE_LNG);
    expect(pointInRing([lng, lat], ring)).toBe(true);
  });

  it('still places an avatar somewhere for a degenerate ring', () => {
    // Every point on one line encloses nothing, but the marker has to go
    // somewhere rather than to null island.
    const line: ClaimRing = [
      [72, 19],
      [72.001, 19],
      [72.002, 19]
    ];

    const [lng, lat] = ringCentroid(line);
    expect(lng).toBeCloseTo(72.001, 6);
    expect(lat).toBeCloseTo(19, 6);
  });

  it('knows inside from outside', () => {
    const ring = ringOf(squareLoop(300, 600, { close: false }));

    expect(pointInRing([BASE_LNG + 0.001, BASE_LAT + 0.001], ring)).toBe(true);
    expect(pointInRing([BASE_LNG - 0.01, BASE_LAT], ring)).toBe(false);
  });

  it('measures distance well enough to close a loop', () => {
    expect(haversineMetres({ latitude: 19, longitude: 72 }, { latitude: 19, longitude: 72 })).toBe(
      0
    );
    const oneDegreeNorth = haversineMetres(
      { latitude: 19, longitude: 72 },
      { latitude: 20, longitude: 72 }
    );
    expect(oneDegreeNorth).toBeGreaterThan(110_000);
    expect(oneDegreeNorth).toBeLessThan(112_000);
  });
});

describe('how much two loops share', () => {
  const block = ringOf(squareLoop(300, 600, { close: false }));

  it('is total for the same ground', () => {
    expect(overlapRatio(block, block)).toBeCloseTo(1, 5);
  });

  it('is nothing for a loop somewhere else', () => {
    const elsewhere = ringOf(
      squareLoop(300, 600, { close: false, originLat: BASE_LAT + 0.05, originLng: BASE_LNG + 0.05 })
    );

    expect(overlapRatio(block, elsewhere)).toBe(0);
  });

  it('is partial for a loop over the same neighbourhood shifted along', () => {
    // Half a block over: the runs are around roughly the same ground.
    const shifted = ringOf(
      squareLoop(300, 600, {
        close: false,
        originLng: BASE_LNG + 150 / metresPerDegreeLng(BASE_LAT)
      })
    );
    const ratio = overlapRatio(block, shifted);

    expect(ratio).toBeGreaterThan(0.4);
    expect(ratio).toBeLessThan(0.6);
  });

  it('gives the same answer every time it is asked', () => {
    // The sample grid is fixed, so two claims never trade ground because a
    // comparison was rerun.
    expect(overlapRatio(block, block)).toBe(overlapRatio(block, block));
  });
});

describe('reading a claim off a run', () => {
  it('claims the loop and times it', () => {
    const detection = detectLoopClaim(squareLoop(300, 600));

    expect('claim' in detection).toBe(true);
    if (!('claim' in detection)) return;
    expect(detection.claim.areaSqm).toBeGreaterThan(80_000);
    expect(detection.claim.durationSeconds).toBeGreaterThan(0);
    expect(detection.claim.boundary.length).toBeGreaterThan(3);
  });

  it('refuses a run that never came back to its start', () => {
    const straightLine: ClaimPoint[] = Array.from({ length: 40 }, (_unused, index) => ({
      latitude: BASE_LAT + index * 0.001,
      longitude: BASE_LNG,
      at: new Date(Date.UTC(2026, 8, 6, 5, 0, index * 10))
    }));

    expect(detectLoopClaim(straightLine)).toEqual({ refusal: 'not_closed' });
  });

  it('refuses a loop around nothing', () => {
    // Ten metres across: a roundabout, or GPS drift standing still.
    expect(detectLoopClaim(squareLoop(10, 60))).toEqual({ refusal: 'too_small' });
  });

  it('refuses a loop no runner covered', () => {
    // Five kilometres a side is a drive, and an area-times-speed mechanic is
    // cheapest to cheat with a car.
    expect(detectLoopClaim(squareLoop(5_000, 600))).toEqual({ refusal: 'too_large' });
  });

  it('refuses a run with too few points to read', () => {
    expect(detectLoopClaim([])).toEqual({ refusal: 'too_few_points' });
  });

  it('times the loop only, so a warm-up and a cool-down cost nothing', () => {
    const loop = squareLoop(300, 600);
    const before: ClaimPoint[] = Array.from({ length: 5 }, (_unused, index) => ({
      latitude: BASE_LAT - 0.02 + index * 0.001,
      longitude: BASE_LNG - 0.02,
      at: new Date(loop[0]!.at.getTime() - (5 - index) * 60_000)
    }));
    const after: ClaimPoint[] = Array.from({ length: 5 }, (_unused, index) => ({
      latitude: BASE_LAT + 0.02 + index * 0.001,
      longitude: BASE_LNG + 0.02,
      at: new Date(loop[loop.length - 1]!.at.getTime() + (index + 1) * 60_000)
    }));

    const bare = detectLoopClaim(loop);
    const padded = detectLoopClaim([...before, ...loop, ...after]);
    if (!('claim' in bare) || !('claim' in padded)) throw new Error('expected both to claim');

    // Ten minutes of jogging to and from the block must not make the loop look
    // twenty minutes slower than a rival's.
    expect(padded.claim.durationSeconds).toBeLessThan(bare.claim.durationSeconds * 1.5);
  });

  it('keeps a boundary small enough to draw', () => {
    const dense = squareLoop(400, 900, { perSide: 300 });
    const detection = detectLoopClaim(dense);
    if (!('claim' in detection)) throw new Error('expected a claim');

    expect(detection.claim.boundary.length).toBeLessThanOrEqual(
      DEFAULT_CLAIM_RULE.maxBoundaryPoints
    );
  });

  it('ignores points that are not real coordinates', () => {
    const loop = squareLoop(300, 600);
    const poisoned: ClaimPoint[] = [
      { latitude: Number.NaN, longitude: BASE_LNG, at: loop[0]!.at },
      { latitude: 91, longitude: BASE_LNG, at: loop[0]!.at },
      ...loop
    ];

    expect('claim' in detectLoopClaim(poisoned)).toBe(true);
  });
});

describe('taking ground off somebody', () => {
  const loop = detectLoopClaim(squareLoop(300, 600));
  if (!('claim' in loop)) throw new Error('fixture must produce a claim');
  const candidate = loop.claim;

  const holder = (durationSeconds: number, id = 'held-1'): HeldClaim => ({
    id,
    boundary: candidate.boundary,
    durationSeconds
  });

  it('takes the ground when the new loop is faster', () => {
    const outcome = claimOutcome(candidate, [holder(candidate.durationSeconds + 60)]);

    expect(outcome).toEqual({ takenOverIds: ['held-1'] });
  });

  it('refuses when the holder was faster', () => {
    const outcome = claimOutcome(candidate, [holder(candidate.durationSeconds - 60)]);

    expect(outcome).toEqual({ refusal: 'slower_than_holder', contestedIds: ['held-1'] });
  });

  it('leaves the ground with the holder on a tie', () => {
    // A tie is not a win, and the alternative hands a claim over on a rounding
    // error.
    const outcome = claimOutcome(candidate, [holder(candidate.durationSeconds)]);

    expect(outcome).toEqual({ refusal: 'slower_than_holder', contestedIds: ['held-1'] });
  });

  it('claims open ground when nobody holds it', () => {
    expect(claimOutcome(candidate, [])).toEqual({ takenOverIds: [] });
  });

  it('ignores a claim somewhere else entirely', () => {
    const elsewhere: HeldClaim = {
      id: 'far',
      boundary: ringOf(
        squareLoop(300, 600, {
          close: false,
          originLat: BASE_LAT + 0.05,
          originLng: BASE_LNG + 0.05
        })
      ),
      durationSeconds: 1
    };

    expect(claimOutcome(candidate, [elsewhere])).toEqual({ takenOverIds: [] });
  });

  it('takes several overlapping claims at once when it beat all of them', () => {
    const outcome = claimOutcome(candidate, [
      holder(candidate.durationSeconds + 30, 'a'),
      holder(candidate.durationSeconds + 60, 'b')
    ]);

    expect(outcome).toEqual({ takenOverIds: ['a', 'b'] });
  });

  it('takes nothing if even one contested holder was faster', () => {
    // Half the ground is not a claim. Beat everyone on it or beat nobody.
    const outcome = claimOutcome(candidate, [
      holder(candidate.durationSeconds + 30, 'slower'),
      holder(candidate.durationSeconds - 30, 'faster')
    ]);

    expect(outcome).toEqual({ refusal: 'slower_than_holder', contestedIds: ['faster'] });
  });
});

describe('what a person is told', () => {
  it('explains every refusal in words they can act on', () => {
    for (const message of Object.values(CLAIM_REFUSAL_MESSAGE)) {
      expect(message.length).toBeGreaterThan(20);
    }
    expect(CLAIM_REFUSAL_MESSAGE.slower_than_holder).toContain('Run it quicker');
    expect(CLAIM_REFUSAL_MESSAGE.not_closed).toContain('Finish near the point you began');
  });
});

describe('hiding where the loop began', () => {
  it('starts the stored ring at a vertex chosen by geography, not by chronology', () => {
    // The polygon never showed where somebody started; the array did, and on a
    // loop run from home the first coordinate is the front door.
    const ring: ClaimRing = [
      [72.9, 19.08],
      [72.88, 19.08],
      [72.88, 19.06],
      [72.9, 19.06]
    ];

    expect(canonicaliseRing(ring)[0]).toEqual([72.88, 19.06]);
  });

  it('gives the same ring whichever point the runner set off from', () => {
    const ring: ClaimRing = [
      [72.9, 19.08],
      [72.88, 19.08],
      [72.88, 19.06],
      [72.9, 19.06]
    ];
    const startedElsewhere: ClaimRing = [...ring.slice(2), ...ring.slice(0, 2)];

    expect(canonicaliseRing(startedElsewhere)).toEqual(canonicaliseRing(ring));
  });

  it('changes the order and nothing else', () => {
    const ring = ringOf(squareLoop(300, 600, { close: false }));
    const rotated = canonicaliseRing(ring);

    expect(rotated).toHaveLength(ring.length);
    expect(ringAreaSqm(rotated)).toBeCloseTo(ringAreaSqm(ring), 6);
    expect([...rotated].sort()).toEqual([...ring].sort());
  });

  it('leaves a ring too small to rotate alone', () => {
    const tiny: ClaimRing = [
      [72, 19],
      [72.001, 19]
    ];

    expect(canonicaliseRing(tiny)).toEqual(tiny);
  });
});

describe('a loop through a private area', () => {
  it('is told what happened and that the run is still theirs', () => {
    // Refusal is the only correct answer: a polygon's boundary is the
    // publication, so there is no way to publish part of it.
    expect(CLAIM_REFUSAL_MESSAGE.privacy_zone).toContain('private areas');
    expect(CLAIM_REFUSAL_MESSAGE.privacy_zone).toContain('run itself is saved');
  });
});
