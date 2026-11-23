import type { Feature, FeatureCollection, Geometry, LineString, Point } from 'geojson';
import type { QuestDetail } from '@runsphere/contracts';
import type { LocalGeoJsonLayer } from '../maps/LocalGeoJsonLayers';

type QuestCheckpoint = QuestDetail['checkpoints'][number];
type Lnglat = [number, number];

/**
 * The quest's own map (the separate map a quest opens to): just its stops and a
 * suggested way round them, with no turf on it.
 *
 * The suggested route is an *order*, not turn-by-turn directions. TURFR has no
 * street router, so legs between stops are straight lines and the copy says
 * so. The server accepts the stops in any order (`services/api/src/quest-core.ts`),
 * so the order is only a suggestion: the nearest unvisited stop next, starting
 * from the quest's published start. A route stop is run along its own path,
 * entered from whichever end is nearer.
 */

const isPosition = (value: unknown): value is Lnglat =>
  Array.isArray(value) &&
  value.length >= 2 &&
  typeof value[0] === 'number' &&
  typeof value[1] === 'number' &&
  Number.isFinite(value[0]) &&
  Number.isFinite(value[1]);
const positions = (value: unknown): Lnglat[] =>
  Array.isArray(value) ? value.filter(isPosition).map((p) => [p[0], p[1]] as Lnglat) : [];

/** Every position in a geometry, flattened; nothing when it isn't one we can read. */
const allPositions = (geometry: unknown): Lnglat[] => {
  const g = geometry as { type?: unknown; coordinates?: unknown; geometries?: unknown } | null;
  if (!g || typeof g !== 'object') return [];
  const c = g.coordinates;
  switch (g.type) {
    case 'Point':
      return isPosition(c) ? [[c[0], c[1]]] : [];
    case 'MultiPoint':
    case 'LineString':
      return positions(c);
    case 'MultiLineString':
    case 'Polygon':
      return Array.isArray(c) ? c.flatMap(positions) : [];
    case 'MultiPolygon':
      return Array.isArray(c)
        ? c.flatMap((polygon) => (Array.isArray(polygon) ? polygon.flatMap(positions) : []))
        : [];
    case 'GeometryCollection':
      return Array.isArray(g.geometries) ? g.geometries.flatMap(allPositions) : [];
    default:
      return [];
  }
};

/** The path a route stop is run along: its first line with two or more points. */
const routePath = (geometry: unknown): Lnglat[] | undefined => {
  const g = geometry as { type?: unknown; coordinates?: unknown; geometries?: unknown } | null;
  if (!g || typeof g !== 'object') return undefined;
  if (g.type === 'LineString') {
    const line = positions(g.coordinates);
    return line.length > 1 ? line : undefined;
  }
  if (g.type === 'MultiLineString' && Array.isArray(g.coordinates))
    return g.coordinates.map(positions).find((line) => line.length > 1);
  if (g.type === 'GeometryCollection' && Array.isArray(g.geometries))
    for (const part of g.geometries) {
      const line = routePath(part);
      if (line) return line;
    }
  return undefined;
};

const mean = (points: readonly Lnglat[]): Lnglat => [
  points.reduce((sum, p) => sum + p[0], 0) / points.length,
  points.reduce((sum, p) => sum + p[1], 0) / points.length
];

/** Squared flat distance, scaled for latitude. Only ever compared, never shown. */
const gap = (a: Lnglat, b: Lnglat): number => {
  const cos = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  const dx = (a[0] - b[0]) * cos;
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
};

export interface QuestStop {
  readonly id: string;
  /** 1-based, in the suggested order. */
  readonly number: number;
  readonly title: string;
  readonly kind: QuestCheckpoint['kind'];
  /** Where the stop's number sits: the place, the area's middle, or where a route is entered. */
  readonly at: Lnglat;
  /** The suggested route through this stop: one point, or a route's whole path. */
  readonly path: readonly Lnglat[];
}

interface Candidate {
  readonly checkpoint: Pick<QuestCheckpoint, 'id' | 'title' | 'kind' | 'geometry'>;
  readonly line?: Lnglat[];
  readonly point: Lnglat;
}

const candidateFor = (
  checkpoint: Pick<QuestCheckpoint, 'id' | 'title' | 'kind' | 'geometry'>
): Candidate | undefined => {
  const line = checkpoint.kind === 'route' ? routePath(checkpoint.geometry) : undefined;
  if (line) return { checkpoint, line, point: line[0]! };
  const all = allPositions(checkpoint.geometry);
  if (!all.length) return undefined;
  // A place is its point; an area (or anything else) is its middle.
  return { checkpoint, point: all.length === 1 ? all[0]! : mean(all) };
};

/**
 * The quest's stops in the suggested order: nearest next, from `from` (the
 * quest's start) or, without one, from the first stop as published.
 */
export const questStops = (
  checkpoints: readonly Pick<QuestCheckpoint, 'id' | 'title' | 'kind' | 'geometry'>[],
  from?: readonly [number, number]
): readonly QuestStop[] => {
  const left = checkpoints.map(candidateFor).filter((c): c is Candidate => Boolean(c));
  const stops: QuestStop[] = [];
  let here: Lnglat | undefined = from ? [from[0], from[1]] : undefined;
  while (left.length) {
    let best = 0;
    let reversed = false;
    if (here) {
      let bestGap = Infinity;
      left.forEach((candidate, index) => {
        const ends: [Lnglat, boolean][] = candidate.line
          ? [
              [candidate.line[0]!, false],
              [candidate.line[candidate.line.length - 1]!, true]
            ]
          : [[candidate.point, false]];
        for (const [end, flip] of ends) {
          const distance = gap(here!, end);
          if (distance < bestGap) {
            bestGap = distance;
            best = index;
            reversed = flip;
          }
        }
      });
    }
    const [next] = left.splice(best, 1);
    const path = next!.line ? (reversed ? [...next!.line].reverse() : next!.line) : [next!.point];
    stops.push({
      id: next!.checkpoint.id,
      number: stops.length + 1,
      title: next!.checkpoint.title,
      kind: next!.checkpoint.kind,
      at: path[0]!,
      path
    });
    here = path[path.length - 1]!;
  }
  return stops;
};

/** The suggested route as one line: the start, then through every stop in order. */
export const suggestedRoute = (
  stops: readonly QuestStop[],
  from?: readonly [number, number]
): Lnglat[] => {
  const line: Lnglat[] = from ? [[from[0], from[1]]] : [];
  for (const stop of stops)
    for (const point of stop.path) {
      const last = line[line.length - 1];
      if (!last || last[0] !== point[0] || last[1] !== point[1]) line.push([point[0], point[1]]);
    }
  return line;
};

/** `[west, south, east, north]` around every stop and the start, for the camera. */
export const questBounds = (
  checkpoints: readonly Pick<QuestCheckpoint, 'geometry'>[],
  from?: readonly [number, number]
): [number, number, number, number] | undefined => {
  const all = checkpoints.flatMap((checkpoint) => allPositions(checkpoint.geometry));
  if (from) all.push([from[0], from[1]]);
  if (!all.length) return undefined;
  const lngs = all.map((p) => p[0]);
  const lats = all.map((p) => p[1]);
  // A single stop still gets a street-sized window rather than a zero-area box.
  const pad = 0.0015;
  return [
    Math.min(...lngs) - pad,
    Math.min(...lats) - pad,
    Math.max(...lngs) + pad,
    Math.max(...lats) + pad
  ];
};

const collection = (features: Feature[]): FeatureCollection<Geometry> => ({
  type: 'FeatureCollection',
  features
});

/**
 * What the quest map draws under the numbered stops: the suggested route
 * (dashed), each route or area stop's own shape, and the quest start.
 *
 * On a live run `from` is where the runner is and `passed` holds the stops
 * already passed: the route is re-planned from here through only the stops
 * still to go, and passed shapes turn the passed colour.
 */
export const questMapLayers = (
  detail: Pick<QuestDetail, 'checkpoints'> | undefined,
  options: {
    from?: readonly [number, number];
    passed?: ReadonlySet<string>;
    /** Mark `from` as the quest start. Off on a live run, where `from` is the runner. */
    showStart?: boolean;
  } = {}
): readonly LocalGeoJsonLayer[] => {
  if (!detail) return [];
  const { passed, showStart = true } = options;
  const stops = questStops(
    detail.checkpoints.filter((checkpoint) => !passed?.has(checkpoint.id)),
    options.from
  );
  const route = suggestedRoute(stops, options.from);
  const shapes = detail.checkpoints
    .filter((checkpoint) => {
      const type = (checkpoint.geometry as { type?: unknown } | null)?.type;
      return type !== 'Point' && type !== 'MultiPoint' && allPositions(checkpoint.geometry).length;
    })
    .map((checkpoint): Feature => ({
      type: 'Feature',
      properties: {
        checkpointId: checkpoint.id,
        passed: Boolean(passed?.has(checkpoint.id))
      },
      geometry: checkpoint.geometry as Geometry
    }));
  const layers: LocalGeoJsonLayer[] = [];
  if (route.length > 1)
    layers.push({
      id: 'quest-suggested-route',
      kind: 'quest-route',
      data: collection([
        {
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: route } satisfies LineString
        }
      ])
    });
  if (shapes.length)
    layers.push({ id: 'quest-stop-shapes', kind: 'quest-stop', data: collection(shapes) });
  if (options.from && showStart)
    layers.push({
      id: 'quest-start',
      kind: 'route-start',
      data: collection([
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Point',
            coordinates: [options.from[0], options.from[1]]
          } satisfies Point
        }
      ])
    });
  return layers;
};

/** The line over the stop list. Any order counts, so the copy never insists on one. */
export const SUGGESTED_ROUTE_NOTE =
  'Numbers show a suggested order. Pass every stop on one run, in any order.';

/**
 * The pins on a live quest run: stops still to go numbered from where the
 * runner is now, nearest next, and the passed ones (shown ticked) after them.
 */
export const liveQuestPins = (
  checkpoints: readonly Pick<QuestCheckpoint, 'id' | 'title' | 'kind' | 'geometry'>[],
  passed: ReadonlySet<string>,
  here?: readonly [number, number]
): readonly QuestStop[] => {
  const ahead = questStops(
    checkpoints.filter((checkpoint) => !passed.has(checkpoint.id)),
    here
  );
  const behind = questStops(checkpoints.filter((checkpoint) => passed.has(checkpoint.id)));
  return [...ahead, ...behind.map((stop) => ({ ...stop, number: ahead.length + stop.number }))];
};

/**
 * Seconds left on a quest's time limit, counted like the server counts it:
 * from the run's first point, pauses included. `undefined` when there is no
 * limit or the run hasn't started.
 */
export const questSecondsLeft = (
  limitMinutes: number | undefined,
  startedAtMs: number | undefined,
  nowMs: number
): number | undefined => {
  if (!limitMinutes || startedAtMs === undefined || !Number.isFinite(startedAtMs)) return undefined;
  return Math.round((startedAtMs + limitMinutes * 60_000 - nowMs) / 1000);
};

/** The time-limit line on a live quest run. Plain, and never a judgement of pace. */
export const questTimeLine = (
  secondsLeft: number | undefined,
  allPassed: boolean
): string | null => {
  if (secondsLeft === undefined) return null;
  if (allPassed) return 'Every stop passed in time.';
  if (secondsLeft <= 0) return "Time's up for this quest. Your run still saves.";
  const minutes = Math.floor(secondsLeft / 60);
  const seconds = (secondsLeft % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds} left to pass every stop`;
};

/** How a quest's time limit is described before the run. */
export const timeLimitLabel = (limitMinutes: number | undefined): string | null =>
  limitMinutes
    ? `Pass every stop within ${limitMinutes} min of starting your run. The clock keeps going if you pause.`
    : null;
