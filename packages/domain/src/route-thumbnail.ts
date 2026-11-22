import { haversineMetres } from './territory-claim.js';

/**
 * Route shapes for the run log (M9 9.13–9.15).
 *
 * A run log card draws its route as a small line, not a map, so it needs the
 * shape and nothing more: at most 100 points across the whole route
 * (`ROUTE_THUMBNAIL_MAX_POINTS`), simplified with Douglas–Peucker so corners
 * survive and straight stretches collapse. The input is always the already
 * privacy-trimmed shareable route; nothing here adds back a removed point.
 *
 * `trimRouteEnds` cuts the first and last stretch of a route for other people
 * when a runner turns on "Hide start and finish" (ADR-0015).
 */

/** `[longitude, latitude]`, as in GeoJSON. */
export type RoutePosition = readonly [number, number];
export type RouteLines = readonly (readonly RoutePosition[])[];

export const ROUTE_THUMBNAIL_MAX_POINTS = 100;

const metresOf = (a: RoutePosition, b: RoutePosition) =>
  haversineMetres({ longitude: a[0], latitude: a[1] }, { longitude: b[0], latitude: b[1] });

/** Distance from `point` to segment `a`–`b` in metres, on a local flat projection. */
const offsetMetres = (point: RoutePosition, a: RoutePosition, b: RoutePosition): number => {
  const scale = Math.cos((a[1] * Math.PI) / 180);
  const ax = a[0] * scale;
  const bx = b[0] * scale;
  const px = point[0] * scale;
  const dx = bx - ax;
  const dy = b[1] - a[1];
  const length = dx * dx + dy * dy;
  const t =
    length === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (point[1] - a[1]) * dy) / length));
  const closest: RoutePosition = [(ax + t * dx) / scale, a[1] + t * dy];
  return metresOf(point, closest);
};

const douglasPeucker = (
  line: readonly RoutePosition[],
  toleranceMetres: number
): RoutePosition[] => {
  if (line.length <= 2) return [...line];
  const keep = new Array<boolean>(line.length).fill(false);
  keep[0] = true;
  keep[line.length - 1] = true;
  const stack: [number, number][] = [[0, line.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop()!;
    let furthest = -1;
    let furthestIndex = -1;
    for (let index = start + 1; index < end; index += 1) {
      const offset = offsetMetres(line[index]!, line[start]!, line[end]!);
      if (offset > furthest) {
        furthest = offset;
        furthestIndex = index;
      }
    }
    if (furthestIndex >= 0 && furthest > toleranceMetres) {
      keep[furthestIndex] = true;
      stack.push([start, furthestIndex], [furthestIndex, end]);
    }
  }
  return line.filter((_, index) => keep[index]);
};

const countPoints = (lines: RouteLines) => lines.reduce((total, line) => total + line.length, 0);

const round6 = (position: RoutePosition): [number, number] => [
  Math.round(position[0] * 1e6) / 1e6,
  Math.round(position[1] * 1e6) / 1e6
];

/**
 * The route simplified to at most `maxPoints` points in total, or null when
 * there is nothing to draw. Lines too short to draw are dropped; if the route
 * has more pieces than the budget allows, the longest ones are kept.
 */
export const routeThumbnail = (
  lines: RouteLines | null | undefined,
  maxPoints = ROUTE_THUMBNAIL_MAX_POINTS
): [number, number][][] | null => {
  let usable = (lines ?? []).filter((line) => line.length >= 2);
  if (usable.length === 0) return null;
  if (usable.length * 2 > maxPoints) {
    usable = [...usable]
      .sort((a, b) => lineMetres(b) - lineMetres(a))
      .slice(0, Math.floor(maxPoints / 2));
  }
  if (countPoints(usable) <= maxPoints) return usable.map((line) => line.map(round6));
  // Find the smallest tolerance that fits the budget, by bisection in metres.
  let low = 0;
  let high = 50_000;
  let best = usable.map((line) => douglasPeucker(line, high));
  for (let step = 0; step < 30; step += 1) {
    const middle = (low + high) / 2;
    const candidate = usable.map((line) => douglasPeucker(line, middle));
    if (countPoints(candidate) <= maxPoints) {
      best = candidate;
      high = middle;
    } else low = middle;
  }
  return best.map((line) => line.map(round6));
};

const lineMetres = (line: readonly RoutePosition[]) => {
  let total = 0;
  for (let index = 1; index < line.length; index += 1)
    total += metresOf(line[index - 1]!, line[index]!);
  return total;
};

/**
 * The route with `metres` cut from its very start and very end, measured
 * along the route across all its pieces. Pieces left with under two points
 * are dropped; a route shorter than twice the cut has nothing left.
 */
export const trimRouteEnds = (lines: RouteLines, metres: number): [number, number][][] => {
  const total = lines.reduce((sum, line) => sum + lineMetres(line), 0);
  if (total <= metres * 2) return [];
  const from = metres;
  const to = total - metres;
  const result: [number, number][][] = [];
  let travelled = 0;
  for (const line of lines) {
    const kept: [number, number][] = [];
    for (let index = 0; index < line.length; index += 1) {
      const point = line[index]!;
      if (index > 0) {
        const previous = line[index - 1]!;
        const step = metresOf(previous, point);
        const startAt = travelled;
        travelled += step;
        // Where this step crosses either cut, add the exact crossing point.
        for (const cut of [from, to]) {
          if (step > 0 && startAt < cut && travelled > cut) {
            const t = (cut - startAt) / step;
            const crossing: [number, number] = [
              previous[0] + t * (point[0] - previous[0]),
              previous[1] + t * (point[1] - previous[1])
            ];
            kept.push(crossing);
          }
        }
        if (travelled >= from && travelled <= to) kept.push([point[0], point[1]]);
      } else if (travelled >= from && travelled <= to) kept.push([point[0], point[1]]);
    }
    if (kept.length >= 2) result.push(kept.map(round6));
  }
  return result;
};
