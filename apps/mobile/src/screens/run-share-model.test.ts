import { describe, expect, it } from 'vitest';
import { SHARE_ROUTE_SIZE, runShareCard, runTitle } from './run-share-model.js';

const metrics = {
  distanceMeters: 5_020,
  elapsedSeconds: 1_635,
  movingPaceSecondsPerKm: 313.7,
  elevation: { gainMeters: 41.6, lossMeters: 40, maxMeters: 60, minMeters: 18 }
};

/** A small synthetic square near 0°, 0°: a shape, not a place. */
const square: [number, number][][] = [
  [
    [0, 0],
    [0.002, 0],
    [0.002, 0.002],
    [0, 0.002],
    [0, 0]
  ]
];

describe('run share card', () => {
  it('shows distance, elapsed time, pace and climb, with the date and a title', () => {
    const card = runShareCard({ metrics, startedAt: '2026-11-24T00:45:00.000Z', lines: square })!;
    expect(card.title).toBe('Morning run');
    expect(card.dateLabel).toBe('Tue 24 Nov');
    expect(card.stats).toEqual([
      { label: 'Distance', value: '5.02 km' },
      { label: 'Elapsed time', value: '27:15' },
      { label: 'Pace', value: '5:14 /km' },
      { label: 'Climb', value: '42 m' }
    ]);
    expect(card.summary).toBe('5.02 km in 27:15 on TURFR.');
  });

  it('draws the route as a line fitted inside the card, with no map under it', () => {
    const card = runShareCard({ metrics, startedAt: '2026-11-24T00:45:00.000Z', lines: square })!;
    expect(card.route?.path.startsWith('M')).toBe(true);
    const numbers = card.route!.path.match(/-?\d+(\.\d+)?/g)!.map(Number);
    expect(Math.min(...numbers)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...numbers)).toBeLessThanOrEqual(SHARE_ROUTE_SIZE);
  });

  it('still makes a card when the route is kept private, and drops a flat climb', () => {
    const flat = { ...metrics, elevation: null };
    const card = runShareCard({
      metrics: flat,
      startedAt: '2026-11-24T00:45:00.000Z',
      lines: null
    })!;
    expect(card.route).toBeNull();
    expect(card.stats.map((stat) => stat.label)).toEqual(['Distance', 'Elapsed time', 'Pace']);
  });

  it('makes no card for a run with no distance or no start time', () => {
    expect(
      runShareCard({
        metrics: { ...metrics, distanceMeters: 0 },
        startedAt: '2026-11-24T00:45:00Z',
        lines: null
      })
    ).toBeNull();
    expect(runShareCard({ metrics, startedAt: 'not a time', lines: null })).toBeNull();
  });

  it('falls back to the day alone for a run from the log with no start time', () => {
    const card = runShareCard({ metrics, startedOn: '2026-11-24', lines: null })!;
    expect(card).toMatchObject({ title: 'Run', dateLabel: 'Tue 24 Nov' });
  });

  it('names the run by the hour it started in India', () => {
    expect(runTitle('2026-11-24T00:45:00Z')).toBe('Morning run'); // 6:15
    expect(runTitle('2026-11-24T06:40:00Z')).toBe('Afternoon run'); // 12:10
    expect(runTitle('2026-11-24T12:30:00Z')).toBe('Evening run'); // 18:00
    expect(runTitle('2026-11-24T17:00:00Z')).toBe('Night run'); // 22:30
  });
});
