import type { QuestDetail } from '@runsphere/contracts';
import type { RecordedLocationSample } from '../activity-recorder-core';

type QuestCheckpoint = QuestDetail['checkpoints'][number];

/**
 * Which quest stops the runner has passed so far, for the Quest run's live
 * list (M9 9.7). Display only: the phone ticks a stop off so the runner knows
 * where to go next, but the quest completes only when the server checks the
 * uploaded run (`services/api/src/quest-core.ts`). The copy never says
 * "complete" mid-run for that reason.
 *
 * The rule mirrors the server's `QUEST_RULE`: points with GPS accuracy of
 * 50 m or better; a place or area counts once the route passes within 30 m;
 * a route counts once 80% of its length lies within 30 m of the run. Distances
 * use a flat projection around the stop, which at a 30 m scale differs from
 * the server's geography by far less than GPS noise.
 */
export const QUEST_STOP_RULE = {
  maximumAccuracyMeters: 50,
  radiusMeters: 30,
  routeCoverage: 0.8,
  /** How finely a route is sampled when measuring coverage. */
  routeStepMeters: 10
} as const;

type Lnglat = readonly [number, number];
type Xy = readonly [number, number];

const EARTH_METRES_PER_DEGREE = 111_320;

/** Projects to metres around `origin`; accurate to well under a metre at this scale. */
const projector = (origin: Lnglat) => {
  const cos = Math.cos((origin[1] * Math.PI) / 180);
  return (point: Lnglat): Xy => [
    (point[0] - origin[0]) * EARTH_METRES_PER_DEGREE * cos,
    (point[1] - origin[1]) * EARTH_METRES_PER_DEGREE
  ];
};

const segmentDistance = (point: Xy, a: Xy, b: Xy): number => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSq = dx * dx + dy * dy;
  const t =
    lengthSq === 0
      ? 0
      : Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSq));
  return Math.hypot(point[0] - (a[0] + t * dx), point[1] - (a[1] + t * dy));
};

/** Distance from a point to a run made of separate segments (gaps never bridge). */
const distanceToRun = (point: Xy, run: readonly (readonly Xy[])[]): number => {
  let best = Infinity;
  for (const segment of run) {
    if (segment.length === 1)
      best = Math.min(best, Math.hypot(point[0] - segment[0]![0], point[1] - segment[0]![1]));
    for (let index = 1; index < segment.length; index += 1)
      best = Math.min(best, segmentDistance(point, segment[index - 1]!, segment[index]!));
  }
  return best;
};

const insideRing = (point: Xy, ring: readonly Xy[]): boolean => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (
      yi > point[1] !== yj > point[1] &&
      point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi
    )
      inside = !inside;
  }
  return inside;
};

const isPosition = (value: unknown): value is Lnglat =>
  Array.isArray(value) &&
  value.length >= 2 &&
  typeof value[0] === 'number' &&
  typeof value[1] === 'number' &&
  Number.isFinite(value[0]) &&
  Number.isFinite(value[1]);
const positions = (value: unknown): Lnglat[] =>
  Array.isArray(value) ? value.filter(isPosition) : [];

/** A stop's geometry as points, lines and polygons, or nothing if it isn't one we can read. */
const shapes = (
  geometry: unknown
): { points: Lnglat[]; lines: Lnglat[][]; polygons: Lnglat[][][] } => {
  const out = { points: [] as Lnglat[], lines: [] as Lnglat[][], polygons: [] as Lnglat[][][] };
  const g = geometry as { type?: unknown; coordinates?: unknown; geometries?: unknown } | null;
  if (!g || typeof g !== 'object') return out;
  const c = g.coordinates;
  if (g.type === 'Point' && isPosition(c)) out.points.push(c);
  else if (g.type === 'MultiPoint') out.points.push(...positions(c));
  else if (g.type === 'LineString') out.lines.push(positions(c));
  else if (g.type === 'MultiLineString' && Array.isArray(c)) out.lines.push(...c.map(positions));
  else if (g.type === 'Polygon' && Array.isArray(c)) out.polygons.push(c.map(positions));
  else if (g.type === 'MultiPolygon' && Array.isArray(c))
    out.polygons.push(
      ...c.map((polygon) => (Array.isArray(polygon) ? polygon.map(positions) : []))
    );
  else if (g.type === 'GeometryCollection' && Array.isArray(g.geometries))
    for (const part of g.geometries) {
      const inner = shapes(part);
      out.points.push(...inner.points);
      out.lines.push(...inner.lines);
      out.polygons.push(...inner.polygons);
    }
  return out;
};

const firstOf = (geometry: ReturnType<typeof shapes>): Lnglat | undefined =>
  geometry.points[0] ?? geometry.lines[0]?.[0] ?? geometry.polygons[0]?.[0]?.[0];

/** Splits the trace where the recorder broke it, so a GPS gap never counts as covered ground. */
const runSegments = (samples: readonly RecordedLocationSample[]): Lnglat[][] => {
  const segments: Lnglat[][] = [];
  let current: Lnglat[] = [];
  for (const sample of samples) {
    if (sample.accuracy === null || sample.accuracy > QUEST_STOP_RULE.maximumAccuracyMeters)
      continue;
    if (sample.segmentBreak && current.length) {
      segments.push(current);
      current = [];
    }
    current.push([sample.longitude, sample.latitude]);
  }
  if (current.length) segments.push(current);
  return segments;
};

const routeCovered = (line: readonly Xy[], run: readonly (readonly Xy[])[]): boolean => {
  let total = 0;
  let covered = 0;
  for (let index = 1; index < line.length; index += 1) {
    const a = line[index - 1]!;
    const b = line[index]!;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const steps = Math.max(1, Math.ceil(length / QUEST_STOP_RULE.routeStepMeters));
    for (let step = 0; step < steps; step += 1) {
      const t = (step + 0.5) / steps;
      const point: Xy = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
      total += length / steps;
      if (distanceToRun(point, run) <= QUEST_STOP_RULE.radiusMeters) covered += length / steps;
    }
  }
  return total > 0 && covered >= QUEST_STOP_RULE.routeCoverage * total;
};

/** Whether the run so far has passed this stop, by the server's rule. */
export const stopPassed = (
  checkpoint: Pick<QuestCheckpoint, 'kind' | 'geometry'>,
  samples: readonly RecordedLocationSample[]
): boolean => {
  const geometry = shapes(checkpoint.geometry);
  const origin = firstOf(geometry);
  const trace = runSegments(samples);
  if (!origin || !trace.length) return false;
  const project = projector(origin);
  const run = trace.map((segment) => segment.map(project));
  if (checkpoint.kind === 'route')
    return geometry.lines.some((line) => line.length > 1 && routeCovered(line.map(project), run));
  const near = (point: Lnglat) =>
    distanceToRun(project(point), run) <= QUEST_STOP_RULE.radiusMeters;
  if (geometry.points.some(near)) return true;
  if (geometry.lines.some((line) => line.some(near))) return true;
  return geometry.polygons.some((polygon) => {
    const outer = polygon[0]?.map(project) ?? [];
    if (outer.length < 3) return false;
    // Inside the area, or within reach of its edge.
    if (run.some((segment) => segment.some((point) => insideRing(point, outer)))) return true;
    return outer.some((corner, index) => {
      const next = outer[(index + 1) % outer.length]!;
      return run.some((segment) =>
        segment.some(
          (point) => segmentDistance(point, corner, next) <= QUEST_STOP_RULE.radiusMeters
        )
      );
    });
  });
};

export interface QuestStopRow {
  readonly id: string;
  readonly title: string;
  readonly passed: boolean;
}

/** The live list: every stop, in the quest's order, with the ones passed ticked. */
export const questStopRows = (
  checkpoints: readonly Pick<QuestCheckpoint, 'id' | 'title' | 'kind' | 'geometry'>[],
  samples: readonly RecordedLocationSample[]
): readonly QuestStopRow[] =>
  checkpoints.map((checkpoint) => ({
    id: checkpoint.id,
    title: checkpoint.title,
    passed: stopPassed(checkpoint, samples)
  }));

/** One line over the list. Says what's left; never that the quest is done. */
export const questStopsLine = (rows: readonly QuestStopRow[]): string => {
  const left = rows.filter((row) => !row.passed).length;
  if (!rows.length) return 'Pass every stop on this run, in any order.';
  if (left === 0) return 'Every stop passed. Your quest is checked once your run is saved.';
  return `${rows.length - left} of ${rows.length} stops passed · any order`;
};
