import { describe, expect, it } from 'vitest';
import { formatTurfPoints, turfPoints, turfPointsLabel } from './turf-points.js';

describe('Turf points', () => {
  it('counts a point per 100 m² of ground, never rounding up', () => {
    expect(turfPoints(31_400)).toBe(314);
    expect(turfPoints(1_999)).toBe(19);
    expect(turfPoints(-5)).toBe(0);
  });

  it('groups like the rest of the app and shows a sliver as less than one', () => {
    expect(formatTurfPoints(31_400_000)).toBe('3,14,000');
    expect(formatTurfPoints(40)).toBe('<1');
    expect(formatTurfPoints(0)).toBe('0');
  });

  it('says point or points', () => {
    expect(turfPointsLabel(31_400)).toBe('314 Turf points');
    expect(turfPointsLabel(100)).toBe('1 Turf point');
    expect(turfPointsLabel(40)).toBe('<1 Turf point');
    expect(turfPointsLabel(0)).toBe('0 Turf points');
  });
});
