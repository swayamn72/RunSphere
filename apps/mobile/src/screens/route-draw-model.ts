/**
 * Drawing a run's route on its detail map (M9 9.18).
 *
 * Once the map is ready the camera fits the route, then the line draws itself
 * from start to finish over `DRAW_DURATION_MS`, easing out, coloured by pace.
 * MapLibre has no trim offset for lines, so the drawing is done by giving the
 * source a growing slice of the route, at most `DRAW_FPS` times a second.
 *
 * The pace colours use `line-gradient`, whose stops run along `line-progress`
 * from 0 to 1 over whatever line the source holds. While only part of the
 * route is drawn, that is the part; so the gradient is recomputed for each
 * slice, and a stretch keeps its colour as the line grows past it.
 */

/** `[longitude, latitude]`. */
export type Position = readonly [number, number];
export type Lines = readonly (readonly Position[])[];

export const DRAW_DURATION_MS = 1_200;
export const DRAW_FPS = 30;
/** Space kept around the route when the camera fits it. */
export const FIT_PADDING = 36;

/** Ease out: fast at first, settling at the finish. */
export const easeOut = (t: number): number => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;

const metres = (a: Position, b: Position) => {
  const rad = Math.PI / 180;
  const x = (b[0] - a[0]) * rad * Math.cos(((a[1] + b[1]) / 2) * rad);
  const y = (b[1] - a[1]) * rad;
  return Math.sqrt(x * x + y * y) * 6_371_000;
};

export const routeLength = (lines: Lines): number =>
  lines.reduce((total, line) => {
    let sum = 0;
    for (let index = 1; index < line.length; index += 1)
      sum += metres(line[index - 1]!, line[index]!);
    return total + sum;
  }, 0);

/** `[west, south, east, north]`, or undefined for an empty route. */
export const routeBounds = (lines: Lines): [number, number, number, number] | undefined => {
  const points = lines.flat();
  if (points.length === 0) return undefined;
  const lngs = points.map(([lng]) => lng);
  const lats = points.map(([, lat]) => lat);
  return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
};

export interface RouteSlice {
  lines: [number, number][][];
  /** The tip, where the glowing dot sits; undefined before anything is drawn. */
  head: [number, number] | undefined;
}

/** The first `fraction` of the route by distance, ending exactly at the tip. */
export const sliceRoute = (lines: Lines, fraction: number): RouteSlice => {
  const total = routeLength(lines);
  const target = total * Math.min(1, Math.max(0, fraction));
  const out: [number, number][][] = [];
  let travelled = 0;
  let head: [number, number] | undefined;
  for (const line of lines) {
    if (line.length < 2) continue;
    const kept: [number, number][] = [[line[0]![0], line[0]![1]]];
    let done = false;
    for (let index = 1; index < line.length; index += 1) {
      const from = line[index - 1]!;
      const to = line[index]!;
      const step = metres(from, to);
      // The whole route ends exactly on its last point, not a rounding short of it.
      if (target < total && travelled + step >= target) {
        const t = step > 0 ? (target - travelled) / step : 0;
        kept.push([from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t]);
        done = true;
        break;
      }
      travelled += step;
      kept.push([to[0], to[1]]);
    }
    if (kept.length >= 2) {
      out.push(kept);
      head = kept[kept.length - 1];
    }
    if (done) break;
  }
  return { lines: target > 0 ? out : [], head: target > 0 ? head : undefined };
};

/** How far through the drawing to be at `elapsedMs`, eased. */
export const drawFraction = (elapsedMs: number, durationMs = DRAW_DURATION_MS): number =>
  easeOut(elapsedMs / durationMs);

/** Frame interval that keeps updates at or under `DRAW_FPS`. */
export const FRAME_MS = Math.ceil(1_000 / DRAW_FPS);

export interface PaceStop {
  /** 0 at the start of the route, 1 at the finish. */
  at: number;
  color: string;
}

/**
 * Pace series `[distanceMeters, secondsPerKm]` into colour stops along the
 * route: the run's own fastest stretch gets `fast`, its slowest `slow`, and
 * the rest blend between. Relative to the run itself, never a judgement
 * against anyone else (`docs/voice.md`). An even run is one colour.
 */
export const paceStops = (
  series: readonly (readonly [number, number])[],
  fast: string,
  slow: string,
  steps = 12
): PaceStop[] => {
  if (series.length < 2)
    return [
      { at: 0, color: fast },
      { at: 1, color: fast }
    ];
  const total = series[series.length - 1]![0];
  const paces = series.map(([, pace]) => pace);
  const quickest = Math.min(...paces);
  const slowest = Math.max(...paces);
  const spread = slowest - quickest;
  const stops: PaceStop[] = [];
  for (let step = 0; step <= steps; step += 1) {
    const at = step / steps;
    const distance = at * total;
    const nearest = series.reduce((best, point) =>
      Math.abs(point[0] - distance) < Math.abs(best[0] - distance) ? point : best
    );
    const mix = spread < 5 ? 0 : (nearest[1] - quickest) / spread;
    stops.push({ at, color: blend(fast, slow, mix) });
  }
  return stops;
};

/**
 * The gradient for a slice that is `fraction` of the route: stops past the
 * tip are dropped, and the rest are spread over the slice's own 0–1.
 */
export const gradientForSlice = (stops: readonly PaceStop[], fraction: number): unknown[] => {
  const shown = Math.max(fraction, 1e-6);
  const kept = stops.filter((stop) => stop.at <= shown);
  const last = stops.find((stop) => stop.at > shown) ?? stops[stops.length - 1]!;
  const scaled = [...kept.map((stop) => ({ at: stop.at / shown, color: stop.color }))];
  if (scaled.length === 0 || scaled[scaled.length - 1]!.at < 1)
    scaled.push({ at: 1, color: last.color });
  if (scaled[0]!.at > 0) scaled.unshift({ at: 0, color: scaled[0]!.color });
  // Stops must strictly increase.
  const unique = scaled.filter((stop, index) => index === 0 || stop.at > scaled[index - 1]!.at);
  return [
    'interpolate',
    ['linear'],
    ['line-progress'],
    ...unique.flatMap((stop) => [stop.at, stop.color])
  ];
};

const channel = (hex: string, offset: number) => parseInt(hex.slice(offset, offset + 2), 16);

/** Mix two `#rrggbb` colours. */
export const blend = (from: string, to: string, mix: number): string => {
  const t = Math.min(1, Math.max(0, mix));
  const parts = [1, 3, 5].map((offset) =>
    Math.round(channel(from, offset) + (channel(to, offset) - channel(from, offset)) * t)
      .toString(16)
      .padStart(2, '0')
  );
  return `#${parts.join('')}`;
};
