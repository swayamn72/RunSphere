import { describe, expect, it } from 'vitest';
import type { RecordedLocationSample } from '../activity-recorder-core';
import { questStopRows, questStopsLine, stopPassed } from './quest-stops-model';

/** About 1 m of latitude, and of longitude at Mumbai's latitude. */
const LAT_M = 1 / 111_320;
const LNG_M = 1 / (111_320 * Math.cos((19.076 * Math.PI) / 180));
const ORIGIN = { lat: 19.076, lng: 72.8777 };
/** A position `east` and `north` metres from the origin, as [lng, lat]. */
const at = (east: number, north: number): [number, number] => [
  ORIGIN.lng + east * LNG_M,
  ORIGIN.lat + north * LAT_M
];
const sample = (
  east: number,
  north: number,
  extra: Partial<RecordedLocationSample> = {}
): RecordedLocationSample => {
  const [longitude, latitude] = at(east, north);
  return {
    recordedAt: '2026-11-22T06:00:00.000Z',
    latitude,
    longitude,
    accuracy: 8,
    altitude: null,
    disposition: 'usable',
    segmentBreak: false,
    ...extra
  };
};
/** A straight run east along the origin's latitude, one sample every 10 m. */
const runEast = (fromM: number, toM: number, north = 0) =>
  Array.from({ length: Math.floor((toM - fromM) / 10) + 1 }, (_, index) =>
    sample(fromM + index * 10, north)
  );

const place = (east: number, north: number) => ({
  kind: 'place' as const,
  geometry: { type: 'Point', coordinates: at(east, north) }
});

describe('quest stops on the live HUD (M9 9.7)', () => {
  it('passes a place within 30 m of the route, not beyond', () => {
    const run = runEast(0, 200);
    expect(stopPassed(place(100, 25), run)).toBe(true);
    expect(stopPassed(place(100, 40), run)).toBe(false);
  });

  it('measures to the line between samples, not just to the samples', () => {
    // Two samples 200 m apart; the stop sits between them, 20 m off the line.
    expect(stopPassed(place(100, 20), [sample(0, 0), sample(200, 0)])).toBe(true);
  });

  it('never bridges a GPS gap the recorder broke', () => {
    const run = [sample(0, 0), sample(200, 0, { segmentBreak: true })];
    expect(stopPassed(place(100, 0), run)).toBe(false);
  });

  it('ignores points with GPS accuracy worse than 50 m, as the server does', () => {
    expect(stopPassed(place(0, 0), [sample(0, 0, { accuracy: 80 })])).toBe(false);
    expect(stopPassed(place(0, 0), [sample(0, 0, { accuracy: null })])).toBe(false);
  });

  it('passes an area run through, or run along within 30 m', () => {
    const area = {
      kind: 'area' as const,
      geometry: {
        type: 'Polygon',
        coordinates: [[at(50, 50), at(150, 50), at(150, 150), at(50, 150), at(50, 50)]]
      }
    };
    expect(stopPassed(area, runEast(0, 200, 100))).toBe(true);
    expect(stopPassed(area, runEast(0, 200, 25))).toBe(true);
    expect(stopPassed(area, runEast(0, 200, 0))).toBe(false);
  });

  it('passes a route only once 80% of it has been run along', () => {
    const route = {
      kind: 'route' as const,
      geometry: { type: 'LineString', coordinates: [at(0, 0), at(1_000, 0)] }
    };
    expect(stopPassed(route, runEast(0, 850))).toBe(true);
    expect(stopPassed(route, runEast(0, 700))).toBe(false);
    // Crossing one end is not running the corridor.
    expect(stopPassed(route, [sample(0, -100), sample(0, 100)])).toBe(false);
  });

  it('reads nothing into a stop it cannot read', () => {
    expect(stopPassed({ kind: 'place', geometry: null }, runEast(0, 100))).toBe(false);
    expect(stopPassed({ kind: 'place', geometry: { type: 'Point' } }, runEast(0, 100))).toBe(false);
  });

  it('lists every stop and says what is left, never that the quest is done', () => {
    const rows = questStopRows(
      [
        { id: 'a', title: 'Gate', ...place(50, 0) },
        { id: 'b', title: 'Pier', ...place(500, 0) }
      ],
      runEast(0, 100)
    );
    expect(rows).toEqual([
      { id: 'a', title: 'Gate', passed: true },
      { id: 'b', title: 'Pier', passed: false }
    ]);
    expect(questStopsLine(rows)).toBe('1 of 2 stops passed · any order');
    const all = rows.map((row) => ({ ...row, passed: true }));
    expect(questStopsLine(all)).toMatch(/^Every stop passed\./);
    expect(questStopsLine(all)).not.toMatch(/complete/i);
    expect(questStopsLine([])).toMatch(/Pass every stop/);
  });
});
