import { describe, expect, it } from 'vitest';
import { h3Indexer } from './h3-indexer.js';
import {
  CLAIM_REFUSAL_MESSAGE,
  canonicaliseRing,
  DEFAULT_CLAIM_RULE,
  assessCarve,
  carveOutcome,
  carvingDecision,
  cellSetAreaSqm,
  cellSetBoundary,
  detectLoopClaim,
  differenceCells,
  effortGrace,
  h3CellSet,
  haversineMetres,
  intersectCells,
  largestConnectedComponent,
  minCarveArea,
  pointInRing,
  ringAreaSqm,
  ringCentroid,
  runSpeed,
  seasonMonthFor,
  type CarveAssessment,
  type ClaimCandidate,
  type ClaimPoint,
  type ClaimRing,
  type H3Indexer,
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

describe('reading a claim off a run', () => {
  it('claims the loop and times it', () => {
    const detection = detectLoopClaim(squareLoop(300, 600));

    expect('claim' in detection).toBe(true);
    if (!('claim' in detection)) return;
    expect(detection.claim.areaSqm).toBeGreaterThan(80_000);
    expect(detection.claim.durationSeconds).toBeGreaterThan(0);
    expect(detection.claim.boundary.length).toBeGreaterThan(3);
  });

  it('measures the perimeter from the trace, not from the drawn boundary', () => {
    // Four 300 m sides is a 1.2 km loop, and it is the numerator of the speed
    // a challenger has to beat — so it comes from the points that were run
    // rather than from a boundary that has been thinned for drawing.
    const detection = detectLoopClaim(squareLoop(300, 600, { perSide: 300 }));
    if (!('claim' in detection)) throw new Error('expected a claim');

    expect(detection.claim.perimeterMetres).toBeGreaterThan(1_150);
    expect(detection.claim.perimeterMetres).toBeLessThan(1_250);
    expect(detection.claim.boundary.length).toBeLessThan(1_200);
  });

  it('excludes a warm-up from the perimeter as well as from the time', () => {
    const loop = squareLoop(300, 600);
    const walkIn: ClaimPoint[] = Array.from({ length: 5 }, (_unused, index) => ({
      latitude: BASE_LAT - 0.02 + index * 0.004,
      longitude: BASE_LNG - 0.02,
      at: new Date(loop[0]!.at.getTime() - (5 - index) * 60_000)
    }));

    const bare = detectLoopClaim(loop);
    const padded = detectLoopClaim([...walkIn, ...loop]);
    if (!('claim' in bare) || !('claim' in padded)) throw new Error('expected both to claim');

    expect(padded.claim.perimeterMetres).toBeCloseTo(bare.claim.perimeterMetres, 0);
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

/**
 * A square grid standing in for H3.
 *
 * The carving rules only ask an indexer four things, and none of them need
 * hexagons. A grid of 1,000 m² cells keyed `row:col` makes every assertion below
 * arithmetic somebody can check by hand — which is the point, because these are
 * the numbers that decide who owns a piece of a city. `h3-indexer.test.ts`
 * covers the real binding.
 */
const GRID_CELL_SQM = 1_000;
const gridIndexer: H3Indexer = {
  version: 'test-grid-1',
  cellsInRing: () => [],
  cellAreaSqm: () => GRID_CELL_SQM,
  neighbours: (cell) => {
    const [row, col] = cell.split(':').map(Number) as [number, number];
    return [`${row - 1}:${col}`, `${row + 1}:${col}`, `${row}:${col - 1}`, `${row}:${col + 1}`];
  },
  ringAround: (cells) => {
    // A bounding box is enough: nothing here asserts on the drawn shape, only
    // that a drawable ring comes back.
    const parsed = cells.map((cell) => cell.split(':').map(Number) as [number, number]);
    const rows = parsed.map(([row]) => row);
    const cols = parsed.map(([, col]) => col);
    const [west, east] = [Math.min(...cols), Math.max(...cols) + 1];
    const [south, north] = [Math.min(...rows), Math.max(...rows) + 1];
    return [
      [west, south],
      [east, south],
      [east, north],
      [west, north]
    ];
  }
};

/** `row:col` cells for a rectangle, sorted the way `h3CellSet` sorts. */
const gridCells = (rows: readonly number[], cols: readonly number[]): readonly string[] =>
  rows.flatMap((row) => cols.map((col) => `${row}:${col}`)).sort();

const range = (from: number, to: number): number[] =>
  Array.from({ length: to - from + 1 }, (_unused, index) => from + index);

describe('cell sets', () => {
  it('is the same set however the loop was run', () => {
    // The array is sorted, so it carries no trace of where somebody started —
    // the same privacy property `canonicaliseRing` gives the boundary.
    const clockwise = ringOf(squareLoop(300, 600, { close: false }));
    const anticlockwise = [...clockwise].reverse();

    expect(h3CellSet(clockwise, DEFAULT_CLAIM_RULE.h3Resolution, h3Indexer)).toEqual(
      h3CellSet(anticlockwise, DEFAULT_CLAIM_RULE.h3Resolution, h3Indexer)
    );
  });

  it('covers a 300 metre block with cells that add up to about its area', () => {
    const cells = h3CellSet(
      ringOf(squareLoop(300, 600, { close: false })),
      DEFAULT_CLAIM_RULE.h3Resolution,
      h3Indexer
    );

    expect(cells.length).toBeGreaterThan(20);
    // Quantised to whole cells, so within a cell or two of 90,000 m².
    expect(cellSetAreaSqm(cells, h3Indexer)).toBeGreaterThan(80_000);
    expect(cellSetAreaSqm(cells, h3Indexer)).toBeLessThan(100_000);
  });

  it('shares nothing with a loop somewhere else', () => {
    const here = h3CellSet(
      ringOf(squareLoop(300, 600, { close: false })),
      DEFAULT_CLAIM_RULE.h3Resolution,
      h3Indexer
    );
    const elsewhere = h3CellSet(
      ringOf(
        squareLoop(300, 600, {
          close: false,
          originLat: BASE_LAT + 0.05,
          originLng: BASE_LNG + 0.05
        })
      ),
      DEFAULT_CLAIM_RULE.h3Resolution,
      h3Indexer
    );

    expect(intersectCells(here, elsewhere)).toEqual([]);
  });

  it('shares about half with a loop shifted half a block along', () => {
    const here = h3CellSet(
      ringOf(squareLoop(300, 600, { close: false })),
      DEFAULT_CLAIM_RULE.h3Resolution,
      h3Indexer
    );
    const shifted = h3CellSet(
      ringOf(
        squareLoop(300, 600, {
          close: false,
          originLng: BASE_LNG + 150 / metresPerDegreeLng(BASE_LAT)
        })
      ),
      DEFAULT_CLAIM_RULE.h3Resolution,
      h3Indexer
    );
    const shared = intersectCells(here, shifted).length / here.length;

    expect(shared).toBeGreaterThan(0.4);
    expect(shared).toBeLessThan(0.6);
  });

  it('subtracts one set from another', () => {
    expect(differenceCells(['a', 'b', 'c'], ['b'])).toEqual(['a', 'c']);
    expect(differenceCells(['a', 'b'], ['a', 'b'])).toEqual([]);
  });

  it('keeps the largest connected group and drops the fragments', () => {
    // Two islands, 3 cells and 1 cell, with a gap between them.
    const islands = gridCells([0], [0, 1, 2]).concat(gridCells([0], [9]));

    expect(largestConnectedComponent(islands, gridIndexer)).toEqual(gridCells([0], [0, 1, 2]));
  });

  it('gives the same answer when two groups are the same size', () => {
    const twins = gridCells([0], [0, 1]).concat(gridCells([0], [9, 10]));
    const first = largestConnectedComponent(twins, gridIndexer);

    // The group holding the lowest-sorted cell wins, whichever order the set
    // arrived in — otherwise two equal halves would change hands depending on
    // how a query happened to come back.
    expect(largestConnectedComponent([...twins].reverse(), gridIndexer)).toEqual(first);
    expect(first).toEqual(gridCells([0], [0, 1]));
  });
});

describe('speed, effort, and grace', () => {
  it('reads a speed off a loop', () => {
    expect(runSpeed(1_000, 300)).toBeCloseTo(3.333, 3);
  });

  it('is zero rather than infinite for a loop with no time on it', () => {
    expect(runSpeed(1_000, 0)).toBe(0);
    expect(runSpeed(0, 300)).toBe(0);
  });

  it('grants the published grace at each effort multiple', () => {
    // The table in `territory-guide.md`, asserted directly.
    expect(effortGrace(1_000, 1_000)).toBeCloseTo(0, 6);
    expect(effortGrace(2_000, 1_000)).toBeCloseTo(0.05, 6);
    expect(effortGrace(3_000, 1_000)).toBeCloseTo(0.1, 6);
    expect(effortGrace(4_000, 1_000)).toBeCloseTo(0.15, 6);
  });

  it('caps grace so a very long slow loop cannot buy a sprinter out', () => {
    expect(effortGrace(50_000, 1_000)).toBe(DEFAULT_CLAIM_RULE.maxEffortGrace);
    expect(effortGrace(500_000, 1_000)).toBe(DEFAULT_CLAIM_RULE.maxEffortGrace);
  });

  it('never gives grace for running a shorter loop', () => {
    expect(effortGrace(500, 1_000)).toBe(0);
  });

  it('requires a real perimeter on both sides before comparing effort', () => {
    expect(effortGrace(1_000, 0)).toBe(0);
    expect(effortGrace(0, 1_000)).toBe(0);
  });

  it('floors the carve threshold at a minimum claim and scales past it', () => {
    expect(minCarveArea(20_000)).toBe(DEFAULT_CLAIM_RULE.minAreaSqm);
    expect(minCarveArea(200_000)).toBe(20_000);
  });
});

describe('the worked examples from the rulebook', () => {
  /** Everything but the two loops, held constant so only effort and pace vary. */
  const contest = (
    challenger: { perimetre: number; seconds: number },
    holder: { perimetre: number; seconds: number }
  ): CarveAssessment =>
    assessCarve({
      challengerPerimeterMetres: challenger.perimetre,
      challengerDurationSeconds: challenger.seconds,
      challengerAreaSqm: 100_000,
      holderPerimeterMetres: holder.perimetre,
      holderDurationSeconds: holder.seconds,
      holderAreaSqm: 100_000,
      intersectionAreaSqm: 30_000
    });

  it('A: same loop size, challenger faster — carves', () => {
    const outcome = contest({ perimetre: 1_000, seconds: 240 }, { perimetre: 1_000, seconds: 300 });

    expect(outcome.graceApplied).toBeCloseTo(0, 6);
    expect(outcome.effectiveSpeedMps).toBeCloseTo(4.17, 2);
    expect(outcome.holderSpeedMps).toBeCloseTo(3.33, 2);
    expect(outcome.decision).toBe('carve');
  });

  it('B: bigger loop, slightly slower pace — no contest', () => {
    const outcome = contest({ perimetre: 3_000, seconds: 900 }, { perimetre: 1_000, seconds: 240 });

    expect(outcome.effortRatio).toBeCloseTo(3, 6);
    expect(outcome.graceApplied).toBeCloseTo(0.1, 6);
    expect(outcome.effectiveSpeedMps).toBeCloseTo(3.67, 2);
    expect(outcome.decision).toBe('no_contest');
  });

  it('C: four times the loop at a decent pace — carves', () => {
    const outcome = contest(
      { perimetre: 4_000, seconds: 1_200 },
      { perimetre: 1_000, seconds: 270 }
    );

    expect(outcome.effortRatio).toBeCloseTo(4, 6);
    expect(outcome.graceApplied).toBeCloseTo(0.15, 6);
    expect(outcome.effectiveSpeedMps).toBeCloseTo(3.83, 2);
    expect(outcome.holderSpeedMps).toBeCloseTo(3.7, 2);
    // Ten percent slower over four times the distance still takes the ground.
    expect(outcome.decision).toBe('carve');
  });

  it('leaves the ground with the holder when the speeds are equal', () => {
    const outcome = contest({ perimetre: 1_000, seconds: 300 }, { perimetre: 1_000, seconds: 300 });

    expect(outcome.decision).toBe('no_contest');
  });

  it('does not contest an overlap under the carve floor', () => {
    const outcome = assessCarve({
      challengerPerimeterMetres: 1_000,
      challengerDurationSeconds: 200,
      challengerAreaSqm: 100_000,
      holderPerimeterMetres: 1_000,
      holderDurationSeconds: 600,
      holderAreaSqm: 100_000,
      // Far faster, but they only clipped a corner.
      intersectionAreaSqm: 4_000
    });

    expect(outcome.minCarveAreaSqm).toBe(10_000);
    expect(outcome.decision).toBe('no_contest');
  });

  it('reports the same decision through the thin wrapper', () => {
    const params = {
      challengerPerimeterMetres: 1_000,
      challengerDurationSeconds: 240,
      challengerAreaSqm: 100_000,
      holderPerimeterMetres: 1_000,
      holderDurationSeconds: 300,
      holderAreaSqm: 100_000,
      intersectionAreaSqm: 30_000
    };

    expect(carvingDecision(params)).toBe(assessCarve(params).decision);
  });
});

describe('carving ground off somebody', () => {
  /** A loop with the numbers the contest needs and a boundary nothing reads. */
  const challenger = (overrides: Partial<ClaimCandidate> = {}): ClaimCandidate => ({
    boundary: ringOf(squareLoop(300, 600, { close: false })),
    centroid: [BASE_LNG, BASE_LAT],
    areaSqm: 24_000,
    perimeterMetres: 1_000,
    durationSeconds: 240,
    startedAt: new Date('2026-09-06T05:00:00.000Z'),
    finishedAt: new Date('2026-09-06T05:04:00.000Z'),
    ...overrides
  });

  /** The holder from the rulebook's example D: a 30-cell line, 30,000 m². */
  const lineHolder = (overrides: Partial<HeldClaim> = {}): HeldClaim => ({
    id: 'held-1',
    cellSet: gridCells([0], range(0, 29)),
    areaSqm: 30_000,
    perimeterMetres: 1_000,
    durationSeconds: 300,
    ...overrides
  });

  /** A strip crossing that line at cols 18-25. */
  const crossingCells = gridCells([-1, 0, 1], range(18, 25));

  it('takes the shared cells and leaves the rest', () => {
    const outcome = carveOutcome(challenger(), crossingCells, [lineHolder()], gridIndexer);
    if ('refusal' in outcome) throw new Error('expected a claim');

    expect(outcome.carved).toHaveLength(1);
    expect(outcome.carved[0]!.carvedCells).toEqual(gridCells([0], range(18, 25)));
    // The challenger keeps its whole loop: it won the only contest it had.
    expect(outcome.cellSet).toEqual(crossingCells);
    expect(outcome.areaSqm).toBe(24_000);
  });

  it('drops the holder disconnected fragment, exactly as example D says', () => {
    const outcome = carveOutcome(challenger(), crossingCells, [lineHolder()], gridIndexer);
    if ('refusal' in outcome) throw new Error('expected a claim');

    // 30,000 m² minus an 8,000 m² bite leaves 18,000 and 4,000. The 4,000
    // island is not connected to the rest, so it is not held by anybody.
    expect(outcome.carved[0]!.survivingCells).toEqual(gridCells([0], range(0, 17)));
    expect(outcome.carved[0]!.survivingAreaSqm).toBe(18_000);
    expect(outcome.carved[0]!.wipedOut).toBe(false);
  });

  it('releases the whole claim when too little survives to defend', () => {
    // A nine-cell holder losing five keeps 4,000 m², under the 5,000 floor. The
    // five taken are also exactly the carve floor, so the contest does run.
    const outcome = carveOutcome(
      challenger(),
      gridCells([0], range(0, 4)),
      [
        lineHolder({
          cellSet: gridCells([0], range(0, 8)),
          areaSqm: 9_000
        })
      ],
      gridIndexer
    );
    if ('refusal' in outcome) throw new Error('expected a claim');

    expect(outcome.carved[0]!.wipedOut).toBe(true);
    expect(outcome.carved[0]!.survivingCells).toEqual([]);
    expect(outcome.carved[0]!.survivingAreaSqm).toBe(0);
  });

  it('gives up the contested cells when the holder was faster', () => {
    // The holder ran the same length loop in less time, so nothing is carved —
    // and the challenger does not get to keep ground somebody else holds. The
    // holder sits on the top row so giving it up leaves the rest connected;
    // a holder across the middle would also split the loop, which is the next
    // test but one.
    const outcome = carveOutcome(
      challenger({ durationSeconds: 400 }),
      crossingCells,
      [lineHolder({ cellSet: gridCells([1], range(18, 25)), areaSqm: 8_000 })],
      gridIndexer
    );
    if ('refusal' in outcome) throw new Error('expected a claim');

    expect(outcome.carved).toEqual([]);
    expect(outcome.defended).toHaveLength(1);
    expect(intersectCells(outcome.cellSet, gridCells([1], range(18, 25)))).toEqual([]);
    expect(outcome.cellSet).toEqual(gridCells([-1, 0], range(18, 25)));
    expect(outcome.areaSqm).toBe(16_000);
  });

  it('gives up cells it could not contest, not only ones it lost', () => {
    // A one-cell overlap is under the carve floor, so no contest runs. The
    // holder still keeps it — otherwise staying under the threshold would be a
    // way to claim a city for free.
    const outcome = carveOutcome(
      challenger(),
      gridCells([0], range(29, 40)),
      [lineHolder()],
      gridIndexer
    );
    if ('refusal' in outcome) throw new Error('expected a claim');

    expect(outcome.carved).toEqual([]);
    expect(outcome.defended[0]!.assessment.decision).toBe('no_contest');
    expect(outcome.cellSet).toEqual(gridCells([0], range(30, 40)));
  });

  it('carves one neighbour and loses to another in the same run', () => {
    // The change from whole-claim takeover: a run used to be refused outright
    // if any contested holder was faster.
    const slower = lineHolder({
      id: 'slower',
      cellSet: gridCells([-1], range(18, 25)),
      areaSqm: 8_000,
      durationSeconds: 300
    });
    const faster = lineHolder({
      id: 'faster',
      cellSet: gridCells([1], range(18, 25)),
      areaSqm: 8_000,
      durationSeconds: 120
    });

    const outcome = carveOutcome(challenger(), crossingCells, [slower, faster], gridIndexer);
    if ('refusal' in outcome) throw new Error('expected a claim');

    expect(outcome.carved.map((entry) => entry.id)).toEqual(['slower']);
    expect(outcome.defended.map((entry) => entry.id)).toEqual(['faster']);
    // It keeps its own row and the row it took, and not the row it lost.
    expect(outcome.cellSet).toEqual(gridCells([-1, 0], range(18, 25)));
  });

  it('settles every contest against the original loop, not the leftovers', () => {
    // Two holders over the same cells would make a sequential settlement depend
    // on which row the database returned first.
    const first = lineHolder({ id: 'first', durationSeconds: 300 });
    const second = lineHolder({ id: 'second', durationSeconds: 320 });

    const forwards = carveOutcome(challenger(), crossingCells, [first, second], gridIndexer);
    const backwards = carveOutcome(challenger(), crossingCells, [second, first], gridIndexer);
    if ('refusal' in forwards || 'refusal' in backwards) throw new Error('expected claims');

    expect([...forwards.carved.map((entry) => entry.id)].sort()).toEqual(['first', 'second']);
    expect(forwards.cellSet).toEqual(backwards.cellSet);
    expect(forwards.areaSqm).toBe(backwards.areaSqm);
  });

  it('claims open ground when nobody holds it', () => {
    const outcome = carveOutcome(challenger(), crossingCells, [], gridIndexer);
    if ('refusal' in outcome) throw new Error('expected a claim');

    expect(outcome.carved).toEqual([]);
    expect(outcome.defended).toEqual([]);
    expect(outcome.cellSet).toEqual(crossingCells);
  });

  it('ignores a claim somewhere else entirely', () => {
    const outcome = carveOutcome(
      challenger(),
      crossingCells,
      [lineHolder({ cellSet: gridCells([90], range(0, 29)) })],
      gridIndexer
    );
    if ('refusal' in outcome) throw new Error('expected a claim');

    expect(outcome.carved).toEqual([]);
    expect(outcome.defended).toEqual([]);
  });

  it('refuses when faster holders leave nothing worth claiming', () => {
    const outcome = carveOutcome(
      challenger({ durationSeconds: 400 }),
      gridCells([0], range(18, 25)),
      [lineHolder()],
      gridIndexer
    );
    if (!('refusal' in outcome)) throw new Error('expected a refusal');

    expect(outcome.refusal).toBe('slower_than_holder');
    expect(outcome.contested).toHaveLength(1);
  });

  it('keeps only the largest piece of its own carved-up loop', () => {
    // An undefeated holder sitting across the middle of the challenger loop
    // splits it in two. A claim is one piece of ground, so the smaller half goes.
    const wall = lineHolder({
      cellSet: gridCells([0], range(0, 20)),
      areaSqm: 21_000,
      durationSeconds: 120
    });
    const straddling = gridCells(range(0, 5), [10])
      .concat(gridCells(range(-8, -1), [10]))
      .sort();

    const outcome = carveOutcome(challenger(), straddling, [wall], gridIndexer);
    if ('refusal' in outcome) throw new Error('expected a claim');

    expect(outcome.cellSet).toEqual(gridCells(range(-8, -1), [10]));
    expect(outcome.areaSqm).toBe(8_000);
  });

  it('redraws a boundary for whatever ground survived', () => {
    const ring = cellSetBoundary(gridCells([0, 1], range(0, 3)), gridIndexer);

    expect(ring.length).toBeGreaterThanOrEqual(3);
  });
});

describe('the season a claim belongs to', () => {
  it('is the Kolkata month, not the UTC one', () => {
    // 19:00 UTC on the 31st is already the 1st in Kolkata, where the reset runs.
    expect(seasonMonthFor(new Date('2026-09-30T19:00:00.000Z'))).toBe('2026-10');
    expect(seasonMonthFor(new Date('2026-09-30T17:00:00.000Z'))).toBe('2026-09');
  });

  it('is the shape the schema stores', () => {
    expect(seasonMonthFor(new Date('2026-01-15T00:00:00.000Z'))).toMatch(
      /^[0-9]{4}-(0[1-9]|1[0-2])$/
    );
  });
});

describe('what a person is told', () => {
  it('explains every refusal in words they can act on', () => {
    for (const message of Object.values(CLAIM_REFUSAL_MESSAGE)) {
      expect(message.length).toBeGreaterThan(20);
    }
    // Time is no longer what gets compared, so the words must not promise it is.
    expect(CLAIM_REFUSAL_MESSAGE.slower_than_holder).toContain('speed');
    expect(CLAIM_REFUSAL_MESSAGE.slower_than_holder).not.toContain('quicker');
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
