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
 * Everything here is pure. No geometry library is used: area, centroid,
 * point-in-ring and overlap are all small enough to own outright, and owning
 * them keeps the rules of the game readable by whoever has to argue about them.
 */

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

const ringBounds = (ring: ClaimRing) => {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const [lng, lat] of ring) {
    west = Math.min(west, lng);
    east = Math.max(east, lng);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  return { west, south, east, north };
};

/** Grid resolution for `overlapRatio`; 32 x 32 is ~1024 samples per comparison. */
const OVERLAP_SAMPLES = 32;

/**
 * How much of `candidate` lies inside `held`, from 0 to 1.
 *
 * Sampled on a fixed grid rather than computed by polygon intersection. A true
 * intersection would be exact and would also be the one piece of this file
 * nobody could check by reading it; a deterministic grid is approximate in a way
 * that is easy to reason about, and the takeover threshold is a blunt number
 * anyway. The grid is fixed, so the same two claims always give the same answer.
 */
export const overlapRatio = (candidate: ClaimRing, held: ClaimRing): number => {
  if (candidate.length < 3 || held.length < 3) return 0;
  const bounds = ringBounds(candidate);
  const width = bounds.east - bounds.west;
  const height = bounds.north - bounds.south;
  if (width <= 0 || height <= 0) return 0;

  let inCandidate = 0;
  let inBoth = 0;
  for (let row = 0; row < OVERLAP_SAMPLES; row += 1) {
    for (let column = 0; column < OVERLAP_SAMPLES; column += 1) {
      // Cell centres, so a sample never lands exactly on the bounding box edge.
      const lng = bounds.west + (width * (column + 0.5)) / OVERLAP_SAMPLES;
      const lat = bounds.south + (height * (row + 0.5)) / OVERLAP_SAMPLES;
      const sample: readonly [number, number] = [lng, lat];
      if (!pointInRing(sample, candidate)) continue;
      inCandidate += 1;
      if (pointInRing(sample, held)) inBoth += 1;
    }
  }
  return inCandidate === 0 ? 0 : inBoth / inCandidate;
};

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
  /** How much of a new loop must sit inside a held claim to contest it. */
  takeoverOverlapRatio: number;
  /** Boundary points kept for storage and drawing. */
  maxBoundaryPoints: number;
}

export const DEFAULT_CLAIM_RULE: ClaimRule = {
  closeWithinMetres: 60,
  minAreaSqm: 5_000,
  maxAreaSqm: 5_000_000,
  takeoverOverlapRatio: 0.6,
  maxBoundaryPoints: 128
};

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
  /** Time taken to run the closed loop. This is what a rival has to beat. */
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

  const startedAt = usable[originalIndex(bestStart)]!.at;
  const finishedAt = usable[originalIndex(bestEnd)]!.at;
  const durationSeconds = Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000);
  if (durationSeconds <= 0) return { refusal: 'no_duration' };

  return {
    claim: {
      boundary,
      centroid: ringCentroid(boundary),
      areaSqm,
      durationSeconds,
      startedAt,
      finishedAt
    }
  };
};

/** A claim already on the map, as far as the takeover rules are concerned. */
export interface HeldClaim {
  id: string;
  boundary: ClaimRing;
  durationSeconds: number;
}

export type ClaimOutcome =
  { refusal: ClaimRefusal; contestedIds: readonly string[] } | { takenOverIds: readonly string[] };

/**
 * What a new loop does to the claims already on the map.
 *
 * A held claim is *contested* when enough of the new loop sits inside it — the
 * two runs are around the same ground. Contesting is decided by area rather than
 * by an exact route match, because nobody runs the same line twice and a
 * mechanic that demanded it would never fire.
 *
 * Then the only question is time. Faster takes it; slower or equal takes
 * nothing. **Equal time leaves the ground with whoever already held it**: a tie
 * is not a win, and the alternative would hand a claim over on a rounding error.
 */
export const claimOutcome = (
  candidate: ClaimCandidate,
  held: readonly HeldClaim[],
  rule: ClaimRule = DEFAULT_CLAIM_RULE
): ClaimOutcome => {
  const contested = held.filter(
    (existing) => overlapRatio(candidate.boundary, existing.boundary) >= rule.takeoverOverlapRatio
  );
  const unbeaten = contested.filter(
    (existing) => existing.durationSeconds <= candidate.durationSeconds
  );
  if (unbeaten.length > 0) {
    return {
      refusal: 'slower_than_holder',
      contestedIds: unbeaten.map((existing) => existing.id)
    };
  }
  return { takenOverIds: contested.map((existing) => existing.id) };
};

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
    'Someone already holds this ground with a faster loop. Run it quicker than they did and it is yours.',
  privacy_zone:
    'This loop passes through one of your private areas. Claiming it would put that area on a public map, so it was not claimed. The run itself is saved as normal.'
};
