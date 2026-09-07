/**
 * Enclosure territory claims — "run a closed loop, hold what it encloses"
 * (Phase 5, milestone 5.1).
 *
 * **This is a deliberate reversal of three earlier decisions**, recorded in
 * ADR-0011. It is not the H3 cell engine in `territory-scoring.ts`, which stays
 * switched off; it is a second, independent mechanic:
 *
 * - **Enclosure, not traversal.** You hold the area inside your loop, including
 *   ground you never stepped on. ADR-0001's cell traversal holds only what you
 *   actually crossed.
 * - **Faster wins.** A rival who runs the same area in less time takes it.
 *   ADR-0005 made scoring pace-neutral; this mechanic is explicitly not, and the
 *   area of a loop grows with the square of its perimeter, so speed and distance
 *   both compound. That is the game being asked for.
 * - **The holder is named.** ADR-0008 forbade owner identity on the map; a claim
 *   carries its owner's display name and avatar, and the boundary is the path
 *   they ran.
 *
 * **Ground is carved, not swapped whole** (`territory-guide.md` v3). A loop that
 * overlaps held ground takes the overlapping part and leaves the rest, decided
 * on speed rather than raw time and softened by an effort allowance so a long
 * loop is not automatically beaten by a tight one. The overlap is computed on
 * H3 cell sets rather than by polygon intersection.
 *
 * Everything here is pure. Area, centroid and point-in-ring are small enough to
 * own outright, and owning them keeps the rules of the game readable by whoever
 * has to argue about them. H3 is the exception: it arrives as an injected
 * `H3Indexer` (`h3-indexer.ts` is the only implementation), so the rules stay
 * testable without a hexagon and the pinned library version travels with every
 * claim as ADR-0001 requires.
 */

import { kolkataDate } from './gamification.js';

/** One validated trace point. Times decide who was faster, so they are required. */
export interface ClaimPoint {
  latitude: number;
  longitude: number;
  at: Date;
}

/** A closed boundary as `[longitude, latitude]` pairs, GeoJSON winding order. */
export type ClaimRing = readonly (readonly [number, number])[];

export const EARTH_RADIUS_METRES = 6_378_137;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/** Great-circle distance in metres. */
export const haversineMetres = (
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number }
): number => {
  const dLat = toRadians(to.latitude - from.latitude);
  const dLon = toRadians(to.longitude - from.longitude);
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);
  const a = Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.min(1, Math.sqrt(a)));
};

/**
 * Geodesic area of a closed ring in square metres, by spherical excess.
 *
 * Signed area is discarded: a loop run clockwise encloses the same ground as one
 * run anticlockwise, and which way somebody happened to go around the block is
 * not a rule anybody would expect.
 */
export const ringAreaSqm = (ring: ClaimRing): number => {
  if (ring.length < 3) return 0;
  let total = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const [lng1, lat1] = ring[index]!;
    const [lng2, lat2] = ring[(index + 1) % ring.length]!;
    total += toRadians(lng2 - lng1) * (2 + Math.sin(toRadians(lat1)) + Math.sin(toRadians(lat2)));
  }
  return Math.abs((total * EARTH_RADIUS_METRES * EARTH_RADIUS_METRES) / 2);
};

/**
 * Planar centroid of a ring, used to place the holder's avatar.
 *
 * Planar rather than geodesic on purpose: a claim spans a few city blocks, where
 * the difference is centimetres, and this has to be cheap enough to run for
 * every claim on screen.
 */
export const ringCentroid = (ring: ClaimRing): readonly [number, number] => {
  if (ring.length === 0) return [0, 0];
  let twiceArea = 0;
  let x = 0;
  let y = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const [x1, y1] = ring[index]!;
    const [x2, y2] = ring[(index + 1) % ring.length]!;
    const cross = x1 * y2 - x2 * y1;
    twiceArea += cross;
    x += (x1 + x2) * cross;
    y += (y1 + y2) * cross;
  }
  if (twiceArea === 0) {
    // A degenerate ring — every point on one line — still needs somewhere to
    // put the avatar, so fall back to the average vertex.
    const sum = ring.reduce((acc, [lng, lat]) => [acc[0] + lng, acc[1] + lat], [0, 0]);
    return [sum[0] / ring.length, sum[1] / ring.length];
  }
  return [x / (3 * twiceArea), y / (3 * twiceArea)];
};

/** Ray casting. Points exactly on an edge are treated as inside. */
export const pointInRing = (point: readonly [number, number], ring: ClaimRing): boolean => {
  const [px, py] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    const straddles = yi > py !== yj > py;
    if (straddles && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

/**
 * The H3 operations the carving rules need, and nothing more.
 *
 * Injected rather than imported so this file stays free of the library, and so
 * a test can hand the rules a grid it fully controls. `h3-indexer.ts` holds the
 * only real implementation, pinned.
 */
export interface H3Indexer {
  /**
   * The pinned library version. Stored on every claim so a disputed carve can
   * be recomputed by the code that decided it (ADR-0001).
   */
  readonly version: string;
  /** Cells covering a `[longitude, latitude]` ring at the given resolution. */
  cellsInRing(ring: ClaimRing, resolution: number): readonly string[];
  /** Area of one cell in square metres. Uniform for a given resolution. */
  cellAreaSqm(cell: string): number;
  /** The cells sharing an edge with this one, excluding itself. */
  neighbours(cell: string): readonly string[];
  /** Outer ring of a contiguous cell set, `[longitude, latitude]`. */
  ringAround(cells: readonly string[]): ClaimRing;
  /** The cell containing a point, at the given resolution. */
  cellAt(latitude: number, longitude: number, resolution: number): string;
  /**
   * The centre of a cell as `[longitude, latitude]`.
   *
   * Used to geocode a *cell* rather than a person: see `territory-geo.ts`.
   */
  cellCentre(cell: string): readonly [number, number];
}

/**
 * The cells a loop encloses, sorted.
 *
 * **Sorting is a privacy measure, not tidiness.** The guide asks for the array
 * to be "indexed from the westernmost cell, not from your start point", for the
 * same reason `canonicaliseRing` rotates the boundary: an array in the order it
 * was run begins at the front door. A lexical sort of H3 indexes does that job
 * more completely than rotating would — the resulting order is a property of
 * the ground, and carries no trace of the run's chronology at all.
 *
 * It also makes every set operation below reproducible, and lets PostgreSQL
 * compare two stored arrays without caring how either was built.
 */
export const h3CellSet = (
  ring: ClaimRing,
  resolution: number,
  h3Indexer: H3Indexer
): readonly string[] =>
  ring.length < 3 ? [] : [...new Set(h3Indexer.cellsInRing(ring, resolution))].sort();

/** Cells in both sets, keeping `a`'s order. */
export const intersectCells = (a: readonly string[], b: readonly string[]): readonly string[] => {
  const held = new Set(b);
  return a.filter((cell) => held.has(cell));
};

/** Cells in `a` that are not in `remove`, keeping `a`'s order. */
export const differenceCells = (
  a: readonly string[],
  remove: readonly string[]
): readonly string[] => {
  const gone = new Set(remove);
  return a.filter((cell) => !gone.has(cell));
};

/**
 * The biggest edge-connected group in a cell set.
 *
 * A carve through the middle of an L-shaped claim leaves two islands. Keeping
 * both would mean a claim that is two disconnected pieces of a city with one
 * name on it, which is neither a loop anybody ran nor a shape anybody can
 * defend, so only the largest group survives and the fragments are dropped.
 *
 * Ties go to the group containing the lowest-sorted cell. Seeds are walked in
 * sorted order rather than in the order they arrived, so the answer does not
 * depend on how the caller assembled the set — two equal halves must not change
 * hands because a query came back in a different order.
 *
 * The published signature in the plan takes only `cells`; adjacency has to come
 * from somewhere, so the indexer is a second argument, as in `h3CellSet`.
 */
export const largestConnectedComponent = (
  cells: readonly string[],
  h3Indexer: H3Indexer
): readonly string[] => {
  const remaining = new Set(cells);
  let largest: string[] = [];
  for (const seed of [...cells].sort()) {
    if (!remaining.delete(seed)) continue;
    const component = [seed];
    const queue = [seed];
    while (queue.length > 0) {
      const cell = queue.pop()!;
      for (const neighbour of h3Indexer.neighbours(cell)) {
        if (!remaining.delete(neighbour)) continue;
        component.push(neighbour);
        queue.push(neighbour);
      }
    }
    if (component.length > largest.length) largest = component;
  }
  return largest.sort();
};

/** Ground held by a cell set. The authoritative area of any claim after a carve. */
export const cellSetAreaSqm = (cells: readonly string[], h3Indexer: H3Indexer): number =>
  cells.length === 0 ? 0 : cells.length * h3Indexer.cellAreaSqm(cells[0]!);

/**
 * The published rules of the mechanic. Every number here is a balance decision
 * somebody should be able to change without touching the code that applies it.
 */
export interface ClaimRule {
  /** How near the end of a loop must come back to its start to count as closed. */
  closeWithinMetres: number;
  /** Below this a "loop" is a roundabout or GPS drift, not a claim. */
  minAreaSqm: number;
  /**
   * Above this it was not run. A 5 km² loop is a 9 km perimeter at best, and in
   * practice means a vehicle — the cheapest possible abuse of an
   * area-times-speed mechanic, so it is refused outright rather than scored.
   */
  maxAreaSqm: number;
  /** Boundary points kept for storage and drawing. */
  maxBoundaryPoints: number;
  /**
   * H3 resolution every cell set is computed at. See `H3_CLAIM_RESOLUTION` for
   * why it is 11 and what that costs.
   */
  h3Resolution: number;
  /**
   * Share of the smaller of the two claims that an overlap must reach before it
   * is worth contesting, floored at `minAreaSqm`. Below it the ground stays
   * with whoever holds it.
   */
  minCarveShare: number;
  /**
   * Grace earned per whole multiple of extra loop length. A challenger running
   * twice the holder's perimeter gets one multiple of this.
   */
  gracePerEffortMultiple: number;
  /**
   * Hard ceiling on grace. Without it, a slow lap of a very long loop would
   * take a sprinter's ground on distance alone.
   */
  maxEffortGrace: number;
}

export const DEFAULT_CLAIM_RULE: ClaimRule = {
  closeWithinMetres: 60,
  minAreaSqm: 5_000,
  maxAreaSqm: 5_000_000,
  maxBoundaryPoints: 128,
  h3Resolution: 11,
  minCarveShare: 0.1,
  gracePerEffortMultiple: 0.05,
  maxEffortGrace: 0.15
};

/** Metres per second around the loop. The quantity the whole contest turns on. */
export const runSpeed = (perimeterMetres: number, durationSeconds: number): number =>
  perimeterMetres > 0 && durationSeconds > 0 ? perimeterMetres / durationSeconds : 0;

/**
 * The allowance a longer loop earns, from 0 to `maxEffortGrace`.
 *
 * A 4 km loop is run at a slower pace per metre than a tight 1 km one by
 * anybody, so comparing raw speed would hand the map permanently to whoever
 * runs the smallest circles. Grace is the acknowledgement that the longer run
 * was more work — capped, because it is an allowance and not a distance
 * contest.
 *
 *   ratio 1x -> 0%    2x -> 5%    3x -> 10%    4x and beyond -> 15%
 */
export const effortGrace = (
  challengerPerimeterMetres: number,
  holderPerimeterMetres: number,
  rule: ClaimRule = DEFAULT_CLAIM_RULE
): number => {
  if (!(challengerPerimeterMetres > 0) || !(holderPerimeterMetres > 0)) return 0;
  const effortRatio = challengerPerimeterMetres / holderPerimeterMetres;
  return Math.min(
    rule.maxEffortGrace,
    Math.max(0, (effortRatio - 1) * rule.gracePerEffortMultiple)
  );
};

/** What the challenger's speed counts as once their extra effort is credited. */
export const graceAdjustedSpeed = (baseSpeed: number, grace: number): number =>
  baseSpeed * (1 + grace);

/** The overlap a contest must reach to be worth running: `max(5,000 m², 10%)`. */
export const minCarveArea = (
  smallerClaimAreaSqm: number,
  rule: ClaimRule = DEFAULT_CLAIM_RULE
): number => Math.max(rule.minAreaSqm, rule.minCarveShare * Math.max(0, smallerClaimAreaSqm));

/** One contest, as the rules see it. */
export interface CarveParams {
  challengerPerimeterMetres: number;
  challengerDurationSeconds: number;
  challengerAreaSqm: number;
  holderPerimeterMetres: number;
  holderDurationSeconds: number;
  holderAreaSqm: number;
  /** Ground the two loops share, from the intersected cell sets. */
  intersectionAreaSqm: number;
}

/**
 * Everything a carve decision was made from.
 *
 * Recorded in full on the event, because a disputed carve is only arguable if
 * the numbers behind it survive: the two speeds, the effort ratio, the grace it
 * earned, and the threshold the overlap had to clear.
 */
export interface CarveAssessment {
  decision: 'carve' | 'no_contest';
  challengerSpeedMps: number;
  holderSpeedMps: number;
  effortRatio: number;
  graceApplied: number;
  effectiveSpeedMps: number;
  minCarveAreaSqm: number;
  intersectionAreaSqm: number;
}

/**
 * Whether a challenger takes the contested ground, and why.
 *
 * Two gates, in order. The overlap has to be big enough to be worth processing;
 * then the challenger's grace-adjusted speed has to be *strictly* greater than
 * the holder's. **A tie leaves the ground where it is** — the alternative hands
 * a claim over on a rounding error.
 */
export const assessCarve = (
  params: CarveParams,
  rule: ClaimRule = DEFAULT_CLAIM_RULE
): CarveAssessment => {
  const challengerSpeedMps = runSpeed(
    params.challengerPerimeterMetres,
    params.challengerDurationSeconds
  );
  const holderSpeedMps = runSpeed(params.holderPerimeterMetres, params.holderDurationSeconds);
  const effortRatio =
    params.holderPerimeterMetres > 0
      ? params.challengerPerimeterMetres / params.holderPerimeterMetres
      : 0;
  const graceApplied = effortGrace(
    params.challengerPerimeterMetres,
    params.holderPerimeterMetres,
    rule
  );
  const effectiveSpeedMps = graceAdjustedSpeed(challengerSpeedMps, graceApplied);
  const minCarveAreaSqm = minCarveArea(
    Math.min(params.challengerAreaSqm, params.holderAreaSqm),
    rule
  );
  const worthContesting = params.intersectionAreaSqm >= minCarveAreaSqm;
  return {
    decision: worthContesting && effectiveSpeedMps > holderSpeedMps ? 'carve' : 'no_contest',
    challengerSpeedMps,
    holderSpeedMps,
    effortRatio,
    graceApplied,
    effectiveSpeedMps,
    minCarveAreaSqm,
    intersectionAreaSqm: params.intersectionAreaSqm
  };
};

/** The decision alone, for callers that do not need to record the reasoning. */
export const carvingDecision = (
  params: CarveParams,
  rule: ClaimRule = DEFAULT_CLAIM_RULE
): CarveAssessment['decision'] => assessCarve(params, rule).decision;

/**
 * The season a claim belongs to, as `YYYY-MM` in Asia/Kolkata.
 *
 * The month is the reset cycle (`territory-guide.md`): every claim expires at
 * 00:01 IST on the 1st, and the map starts empty. Computed in Kolkata rather
 * than UTC so a run at 04:00 IST on the 1st belongs to the month the runner is
 * actually in, which is the same timezone every other period in this product
 * uses (ADR-0006).
 */
export const seasonMonthFor = (instant: Date): string => kolkataDate(instant).slice(0, 7);

export type ClaimRefusal =
  | 'not_closed'
  | 'too_few_points'
  | 'too_small'
  | 'too_large'
  | 'no_duration'
  | 'slower_than_holder'
  | 'privacy_zone';

export interface ClaimCandidate {
  boundary: ClaimRing;
  centroid: readonly [number, number];
  areaSqm: number;
  /**
   * Ground covered around the loop, in metres, summed over the *unthinned*
   * trace.
   *
   * Measured from what was run rather than from the stored boundary on purpose:
   * the boundary is simplified for drawing, and a rival's contest is decided
   * against the distance the holder actually covered, not against a polygon
   * that lost a third of its vertices on the way into the database.
   */
  perimeterMetres: number;
  /** Time taken to run the closed loop. Divided into the perimeter, this is the speed to beat. */
  durationSeconds: number;
  startedAt: Date;
  finishedAt: Date;
}

export type ClaimDetection = { claim: ClaimCandidate } | { refusal: ClaimRefusal };

/** Evenly thins a ring to at most `limit` points, always keeping the first. */
const thinRing = (ring: ClaimRing, limit: number): ClaimRing => {
  if (ring.length <= limit) return ring;
  const step = ring.length / limit;
  const thinned: (readonly [number, number])[] = [];
  for (let index = 0; index < limit; index += 1) thinned.push(ring[Math.floor(index * step)]!);
  return thinned;
};

/** Points that are actually usable: finite coordinates and a real time. */
const usablePoints = (points: readonly ClaimPoint[]): ClaimPoint[] =>
  points.filter(
    (point) =>
      Number.isFinite(point.latitude) &&
      Number.isFinite(point.longitude) &&
      Math.abs(point.latitude) <= 90 &&
      Math.abs(point.longitude) <= 180 &&
      !Number.isNaN(point.at.getTime())
  );

/** Scanning every pair is quadratic, so the search runs on a thinned trace. */
const SCAN_LIMIT = 400;

/**
 * Find the claim a run earned, if any.
 *
 * The rule is "the longest closed stretch of the run": the widest-separated pair
 * of points that come back within `closeWithinMetres` of each other. Longest
 * rather than largest-area, because it is the one a person can predict — you
 * closed a loop, and the loop you closed is the one you get — and because
 * picking the largest-area sub-loop would quietly reward running a figure eight
 * and taking whichever half happened to be bigger.
 *
 * The duration is measured across that stretch and not across the whole run, so
 * a warm-up before the loop and a cool-down after it neither help nor hurt.
 */
export const detectLoopClaim = (
  points: readonly ClaimPoint[],
  rule: ClaimRule = DEFAULT_CLAIM_RULE
): ClaimDetection => {
  const usable = usablePoints(points);
  if (usable.length < 4) return { refusal: 'too_few_points' };

  const scanned = thinRing(
    usable.map((point) => [point.longitude, point.latitude] as const),
    SCAN_LIMIT
  );
  const scale = usable.length / scanned.length;
  const originalIndex = (scanIndex: number): number =>
    Math.min(usable.length - 1, Math.floor(scanIndex * scale));

  let bestStart = -1;
  let bestEnd = -1;
  for (let start = 0; start < scanned.length; start += 1) {
    // Only a longer span than the best so far can win, so walk inwards from the
    // end and stop as soon as the remaining span could not beat it.
    for (let end = scanned.length - 1; end > start + 2; end -= 1) {
      if (end - start <= bestEnd - bestStart) break;
      const from = { longitude: scanned[start]![0], latitude: scanned[start]![1] };
      const to = { longitude: scanned[end]![0], latitude: scanned[end]![1] };
      if (haversineMetres(from, to) > rule.closeWithinMetres) continue;
      bestStart = start;
      bestEnd = end;
      break;
    }
  }
  if (bestStart < 0) return { refusal: 'not_closed' };

  const boundary = thinRing(scanned.slice(bestStart, bestEnd + 1), rule.maxBoundaryPoints);
  if (boundary.length < 3) return { refusal: 'too_few_points' };

  const areaSqm = ringAreaSqm(boundary);
  if (areaSqm < rule.minAreaSqm) return { refusal: 'too_small' };
  if (areaSqm > rule.maxAreaSqm) return { refusal: 'too_large' };

  const fromIndex = originalIndex(bestStart);
  const toIndex = originalIndex(bestEnd);
  const startedAt = usable[fromIndex]!.at;
  const finishedAt = usable[toIndex]!.at;
  const durationSeconds = Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000);
  if (durationSeconds <= 0) return { refusal: 'no_duration' };

  // Every accepted point of the loop, not the thinned boundary: this is the
  // distance the runner covered, and it is half of the speed a challenger has
  // to beat.
  let perimeterMetres = 0;
  for (let index = fromIndex; index < toIndex; index += 1) {
    perimeterMetres += haversineMetres(usable[index]!, usable[index + 1]!);
  }

  return {
    claim: {
      boundary,
      centroid: ringCentroid(boundary),
      areaSqm,
      perimeterMetres,
      durationSeconds,
      startedAt,
      finishedAt
    }
  };
};

/** A claim already on the map, as far as the carving rules are concerned. */
export interface HeldClaim {
  id: string;
  /** The ground it holds. Authoritative — the stored polygon is for drawing. */
  cellSet: readonly string[];
  areaSqm: number;
  perimeterMetres: number;
  durationSeconds: number;
}

/** What one contest did to one holder. */
export interface ContestedHolder {
  id: string;
  assessment: CarveAssessment;
  /** Cells taken from them. Empty when they held. */
  carvedCells: readonly string[];
  /** What they keep, after fragments are dropped. Empty when wiped out. */
  survivingCells: readonly string[];
  survivingAreaSqm: number;
  /**
   * True when what survived fell under the minimum claim, so the whole claim is
   * released rather than left as a sliver nobody could defend.
   */
  wipedOut: boolean;
}

export type CarveOutcome =
  | { refusal: ClaimRefusal; contested: readonly ContestedHolder[] }
  | {
      /** What the challenger ends up holding. */
      cellSet: readonly string[];
      areaSqm: number;
      /** Holders who lost ground. */
      carved: readonly ContestedHolder[];
      /** Holders who kept theirs — a successful defence, recorded as one. */
      defended: readonly ContestedHolder[];
    };

/**
 * What a new loop does to the claims already on the map.
 *
 * Each overlap is settled on its own: the challenger can carve one neighbour
 * and lose to another in the same run, and comes away holding whatever nobody
 * beat them on. This is the substantive change from the whole-claim takeover
 * that shipped first — a run that overlaps a faster holder by a corner used to
 * be refused outright.
 *
 * **Every contest is measured against the challenger's original cell set**, not
 * against what is left of it after the previous contest was settled. Settling
 * them in sequence would make the result depend on the order rows came back
 * from the database, which is exactly what the single deciding transaction
 * exists to prevent.
 *
 * **The challenger only ever keeps ground no undefeated holder holds.** That
 * covers both ways a contest can fail — losing on speed, and an overlap too
 * small to be worth contesting. Letting an under-threshold overlap stand for
 * both sides would put two names on the same ground, and would make claiming
 * repeatedly just under the threshold a way to take a city for free.
 */
export const carveOutcome = (
  candidate: ClaimCandidate,
  candidateCells: readonly string[],
  held: readonly HeldClaim[],
  h3Indexer: H3Indexer,
  rule: ClaimRule = DEFAULT_CLAIM_RULE
): CarveOutcome => {
  const contested: ContestedHolder[] = [];
  for (const holder of held) {
    const intersection = intersectCells(candidateCells, holder.cellSet);
    if (intersection.length === 0) continue;

    const assessment = assessCarve(
      {
        challengerPerimeterMetres: candidate.perimeterMetres,
        challengerDurationSeconds: candidate.durationSeconds,
        challengerAreaSqm: candidate.areaSqm,
        holderPerimeterMetres: holder.perimeterMetres,
        holderDurationSeconds: holder.durationSeconds,
        holderAreaSqm: holder.areaSqm,
        intersectionAreaSqm: cellSetAreaSqm(intersection, h3Indexer)
      },
      rule
    );

    if (assessment.decision === 'no_contest') {
      contested.push({
        id: holder.id,
        assessment,
        carvedCells: [],
        survivingCells: holder.cellSet,
        survivingAreaSqm: holder.areaSqm,
        wipedOut: false
      });
      continue;
    }

    const surviving = largestConnectedComponent(
      differenceCells(holder.cellSet, intersection),
      h3Indexer
    );
    const survivingAreaSqm = cellSetAreaSqm(surviving, h3Indexer);
    const wipedOut = survivingAreaSqm < rule.minAreaSqm;
    contested.push({
      id: holder.id,
      assessment,
      carvedCells: intersection,
      survivingCells: wipedOut ? [] : surviving,
      survivingAreaSqm: wipedOut ? 0 : survivingAreaSqm,
      wipedOut
    });
  }

  const carved = contested.filter((entry) => entry.carvedCells.length > 0);
  const defended = contested.filter((entry) => entry.carvedCells.length === 0);
  const withheld = defended.flatMap((entry) =>
    intersectCells(candidateCells, entry.survivingCells)
  );
  const claimed = largestConnectedComponent(differenceCells(candidateCells, withheld), h3Indexer);
  const areaSqm = cellSetAreaSqm(claimed, h3Indexer);

  if (areaSqm < rule.minAreaSqm) {
    // Which refusal depends on why there is nothing left. If somebody held
    // ground inside this loop, that is the fact the runner needs; a loop that
    // was simply too small never reaches here, because `detectLoopClaim`
    // already refused it.
    return {
      refusal: defended.length > 0 ? 'slower_than_holder' : 'too_small',
      contested
    };
  }

  return { cellSet: claimed, areaSqm, carved, defended };
};

/**
 * The boundary to draw for a cell set, canonicalised and thinned.
 *
 * A carved claim is no longer the loop that was run, so the stored polygon has
 * to be redrawn from the ground that survived — otherwise the map keeps showing
 * a holder territory they no longer own, which is the one thing a territory map
 * must never do.
 */
export const cellSetBoundary = (
  cells: readonly string[],
  h3Indexer: H3Indexer,
  rule: ClaimRule = DEFAULT_CLAIM_RULE
): ClaimRing => canonicaliseRing(thinRing(h3Indexer.ringAround(cells), rule.maxBoundaryPoints));

/**
 * Rotate a ring to a deterministic first vertex — westernmost, then
 * southernmost.
 *
 * A closed polygon does not show where on it somebody started, but the *array*
 * does: the first coordinate is the point they set off from, which on a loop
 * run from home is the front door. Rotating to a vertex chosen by geography
 * rather than by chronology removes that, and changes nothing about the shape
 * or the area.
 *
 * This is the ordering counterpart to the privacy-zone check: one keeps a loop
 * out of protected ground, the other keeps the loop from saying where it began.
 */
export const canonicaliseRing = (ring: ClaimRing): ClaimRing => {
  if (ring.length < 3) return ring;
  let start = 0;
  for (let index = 1; index < ring.length; index += 1) {
    const [lng, lat] = ring[index]!;
    const [bestLng, bestLat] = ring[start]!;
    if (lng < bestLng || (lng === bestLng && lat < bestLat)) start = index;
  }
  return [...ring.slice(start), ...ring.slice(0, start)];
};

/**
 * Said before somebody's first claim, and again after it.
 *
 * A privacy zone only protects a person who created one, and the people most
 * exposed by a public map of their own streets are exactly the ones who never
 * thought to set one. Rather than inferring where somebody lives — which would
 * mean storing the very fact the zone exists to hide — the app asks everybody
 * once, at the moment the consequence becomes real.
 */
export const CLAIM_PUBLISHES_NOTICE =
  'Claiming puts this loop on a public map with your name on it. If your run starts at home, set a private area in the You tab first — a loop that passes through one is never published.';

export const FIRST_CLAIM_PRIVACY_PROMPT =
  'That loop is now on a public map with your name on it. If it starts near home, set a private area in the You tab — loops through it are refused rather than published, and this one can be removed.';

/** What a person is told when a run did not become a claim. */
export const CLAIM_REFUSAL_MESSAGE: Readonly<Record<ClaimRefusal, string>> = {
  not_closed:
    'Your run did not come back to where the loop started, so there was nothing to enclose. Finish near the point you began the loop.',
  too_few_points: 'That run was too short to read a loop from.',
  too_small: 'That loop encloses too little ground to claim. Go around a bigger block.',
  too_large:
    'That loop encloses more ground than a run can cover, so it was not counted. Territory is for running.',
  no_duration: 'That loop has no time on it, so there was nothing to compare.',
  slower_than_holder:
    'Every part of this loop is already held by someone with a faster loop, so there was nothing left to claim. Beat one of them on speed — a longer loop counts for a little more — and their ground is yours.',
  privacy_zone:
    'This loop passes through one of your private areas. Claiming it would put that area on a public map, so it was not claimed. The run itself is saved as normal.'
};
