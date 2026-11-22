import { describe, expect, it } from 'vitest';
import {
  ROUTE_THUMBNAIL_MAX_POINTS,
  routeThumbnail,
  trimRouteEnds,
  type RoutePosition
} from './route-thumbnail.js';
import { EARTH_RADIUS_METRES, haversineMetres } from './territory-claim.js';

const DEGREES_PER_METRE = 180 / (EARTH_RADIUS_METRES * Math.PI);
const BASE: RoutePosition = [72.838, 19.028];

/** A square loop of `side` metres, one point every metre. Synthetic, not a real route. */
const squareLoop = (side: number): RoutePosition[] => {
  const scale = Math.cos((BASE[1] * Math.PI) / 180);
  const points: RoutePosition[] = [];
  const corners = [
    [0, 0],
    [side, 0],
    [side, side],
    [0, side],
    [0, 0]
  ] as const;
  for (let edge = 0; edge < 4; edge += 1) {
    const [x0, y0] = corners[edge]!;
    const [x1, y1] = corners[edge + 1]!;
    for (let step = 0; step < side; step += 1) {
      const x = x0 + ((x1 - x0) * step) / side;
      const y = y0 + ((y1 - y0) * step) / side;
      points.push([BASE[0] + (x * DEGREES_PER_METRE) / scale, BASE[1] + y * DEGREES_PER_METRE]);
    }
  }
  points.push(points[0]!);
  return points;
};

const northLine = (metres: number): RoutePosition[] =>
  Array.from({ length: metres + 1 }, (_, index) => [BASE[0], BASE[1] + index * DEGREES_PER_METRE]);

const lengthOf = (lines: readonly (readonly RoutePosition[])[]) =>
  lines.reduce((total, line) => {
    let sum = 0;
    for (let index = 1; index < line.length; index += 1)
      sum += haversineMetres(
        { longitude: line[index - 1]![0], latitude: line[index - 1]![1] },
        { longitude: line[index]![0], latitude: line[index]![1] }
      );
    return total + sum;
  }, 0);

describe('routeThumbnail (M9 9.13)', () => {
  it('keeps a long loop to 100 points and keeps its corners', () => {
    const thumbnail = routeThumbnail([squareLoop(500)])!;
    const points = thumbnail.flat();
    expect(points.length).toBeLessThanOrEqual(ROUTE_THUMBNAIL_MAX_POINTS);
    // A square needs only its corners.
    expect(points.length).toBeLessThanOrEqual(10);
    expect(lengthOf(thumbnail)).toBeGreaterThan(1_990);
  });

  it('leaves a short route as it is', () => {
    const line = northLine(20);
    expect(routeThumbnail([line])!.flat()).toHaveLength(21);
  });

  it('keeps a wiggly route within budget across several pieces', () => {
    const wiggle = (offset: number): RoutePosition[] =>
      Array.from({ length: 400 }, (_, index) => [
        BASE[0] + offset + Math.sin(index / 3) * 20 * DEGREES_PER_METRE,
        BASE[1] + index * 5 * DEGREES_PER_METRE
      ]);
    const thumbnail = routeThumbnail([wiggle(0), wiggle(0.01)])!;
    expect(thumbnail).toHaveLength(2);
    expect(thumbnail.flat().length).toBeLessThanOrEqual(ROUTE_THUMBNAIL_MAX_POINTS);
    expect(thumbnail.flat().length).toBeGreaterThan(50);
  });

  it('keeps the longest pieces when there are too many to draw', () => {
    const pieces = Array.from({ length: 80 }, (_, index) => northLine(index + 2));
    const thumbnail = routeThumbnail(pieces)!;
    expect(thumbnail.length).toBe(ROUTE_THUMBNAIL_MAX_POINTS / 2);
    expect(thumbnail.flat().length).toBeLessThanOrEqual(ROUTE_THUMBNAIL_MAX_POINTS);
  });

  it('has nothing to draw for no route or single points', () => {
    expect(routeThumbnail(null)).toBeNull();
    expect(routeThumbnail([])).toBeNull();
    expect(routeThumbnail([[BASE]])).toBeNull();
  });
});

describe('trimRouteEnds (ADR-0015)', () => {
  it('cuts the first and last 200 m along the route', () => {
    const trimmed = trimRouteEnds([northLine(1_000)], 200);
    expect(lengthOf(trimmed)).toBeCloseTo(600, 0);
    const first = trimmed[0]![0]!;
    expect((first[1] - BASE[1]) / DEGREES_PER_METRE).toBeCloseTo(200, 0);
  });

  it('measures across pieces, dropping a piece that falls inside a cut', () => {
    const near = northLine(150);
    const far = northLine(1_000).map(([x, y]): RoutePosition => [x + 0.01, y]);
    const trimmed = trimRouteEnds([near, far], 200);
    expect(trimmed).toHaveLength(1);
    expect(lengthOf(trimmed)).toBeCloseTo(1_150 - 400, 0);
  });

  it('leaves nothing of a route shorter than both cuts', () => {
    expect(trimRouteEnds([northLine(350)], 200)).toEqual([]);
  });
});
