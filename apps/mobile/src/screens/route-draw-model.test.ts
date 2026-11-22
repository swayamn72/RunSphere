import { describe, expect, it } from 'vitest';
import {
  DRAW_FPS,
  FRAME_MS,
  blend,
  drawFraction,
  easeOut,
  gradientForSlice,
  paceStops,
  routeBounds,
  routeLength,
  sliceRoute,
  type Lines
} from './route-draw-model.js';

/** 1 km due north in ten steps, then 500 m due east. Synthetic, near 0°, 0°. */
const DEG = 1 / 111_195;
const north: [number, number][] = Array.from({ length: 11 }, (_, i) => [0, i * 100 * DEG]);
const east: [number, number][] = Array.from({ length: 6 }, (_, i) => [i * 100 * DEG, 1_000 * DEG]);
const route: Lines = [north, east];

describe('drawing a run’s route (M9 9.18)', () => {
  it('measures the route and the box the camera fits', () => {
    expect(routeLength(route)).toBeCloseTo(1_500, -1);
    expect(routeBounds(route)).toEqual([0, 0, 500 * DEG, 1_000 * DEG]);
    expect(routeBounds([])).toBeUndefined();
  });

  it('draws the route from start to finish, the tip exactly where the line ends', () => {
    expect(sliceRoute(route, 0)).toEqual({ lines: [], head: undefined });
    const half = sliceRoute(route, 0.5);
    expect(half.lines).toHaveLength(1);
    expect(half.head![1] / DEG).toBeCloseTo(750, -1);
    expect(half.lines[0]!.at(-1)).toEqual(half.head);
    const most = sliceRoute(route, 0.9);
    expect(most.lines).toHaveLength(2);
    expect(most.head![0] / DEG).toBeCloseTo(350, -1);
    const whole = sliceRoute(route, 1);
    expect(whole.lines.flat()).toHaveLength(north.length + east.length);
    expect(whole.head).toEqual(east.at(-1));
  });

  it('eases out over 1.2 s at no more than 30 frames a second', () => {
    expect(easeOut(0)).toBe(0);
    expect(easeOut(1)).toBe(1);
    expect(easeOut(0.5)).toBeGreaterThan(0.5);
    expect(drawFraction(600)).toBeCloseTo(0.875, 3);
    expect(drawFraction(5_000)).toBe(1);
    expect(1_000 / FRAME_MS).toBeLessThanOrEqual(DRAW_FPS);
  });

  it('colours the run from its own quickest stretch to its easiest, and an even run one colour', () => {
    const series: [number, number][] = [
      [0, 300],
      [500, 300],
      [1_000, 360],
      [1_500, 360]
    ];
    const stops = paceStops(series, '#00ff00', '#ff0000', 4);
    expect(stops[0]).toEqual({ at: 0, color: '#00ff00' });
    expect(stops.at(-1)).toEqual({ at: 1, color: '#ff0000' });
    const even = paceStops(
      [
        [0, 300],
        [1_000, 302]
      ],
      '#00ff00',
      '#ff0000'
    );
    expect(new Set(even.map((stop) => stop.color))).toEqual(new Set(['#00ff00']));
    expect(paceStops([], '#00ff00', '#ff0000')).toHaveLength(2);
  });

  it('keeps each stretch’s colour while the line is only partly drawn', () => {
    const stops = [
      { at: 0, color: '#000000' },
      { at: 0.5, color: '#808080' },
      { at: 1, color: '#ffffff' }
    ];
    const half = gradientForSlice(stops, 0.5);
    expect(half).toEqual([
      'interpolate',
      ['linear'],
      ['line-progress'],
      0,
      '#000000',
      1,
      '#808080'
    ]);
    const whole = gradientForSlice(stops, 1);
    expect(whole.slice(3)).toEqual([0, '#000000', 0.5, '#808080', 1, '#ffffff']);
    const early = gradientForSlice(stops, 0.25);
    expect(early.slice(3)).toEqual([0, '#000000', 1, '#808080']);
  });

  it('blends colours', () => {
    expect(blend('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(blend('#000000', '#ffffff', 2)).toBe('#ffffff');
  });
});
