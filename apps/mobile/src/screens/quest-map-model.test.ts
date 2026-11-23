import { describe, expect, it } from 'vitest';
import {
  liveQuestPins,
  questBounds,
  questMapLayers,
  questSecondsLeft,
  questStops,
  questTimeLine,
  suggestedRoute,
  timeLimitLabel
} from './quest-map-model';

const place = (id: string, at: [number, number]) => ({
  id,
  title: id,
  kind: 'place' as const,
  geometry: { type: 'Point', coordinates: at }
});

describe('quest map', () => {
  const far = place('far', [72.9, 19.1]);
  const near = place('near', [72.881, 19.073]);
  const middle = place('middle', [72.89, 19.085]);
  const start: [number, number] = [72.88, 19.072];

  it('numbers the stops nearest-next from the quest start', () => {
    const stops = questStops([far, near, middle], start);
    expect(stops.map((stop) => [stop.number, stop.id])).toEqual([
      [1, 'near'],
      [2, 'middle'],
      [3, 'far']
    ]);
  });

  it('keeps the published order when there is no start', () => {
    expect(questStops([far, near], undefined)[0]?.id).toBe('far');
  });

  it('enters a route stop from its nearer end and runs its whole path', () => {
    const route = {
      id: 'path',
      title: 'Path',
      kind: 'route' as const,
      geometry: {
        type: 'LineString',
        coordinates: [
          [72.89, 19.09],
          [72.885, 19.08],
          [72.881, 19.073]
        ]
      }
    };
    const [stop] = questStops([route], start);
    expect(stop?.at).toEqual([72.881, 19.073]);
    expect(stop?.path).toHaveLength(3);
    expect(suggestedRoute(questStops([route], start), start)).toEqual([
      start,
      [72.881, 19.073],
      [72.885, 19.08],
      [72.89, 19.09]
    ]);
  });

  it('puts an area stop at its middle', () => {
    const area = {
      id: 'park',
      title: 'Park',
      kind: 'area' as const,
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [2, 0],
            [2, 2],
            [0, 2]
          ]
        ]
      }
    };
    expect(questStops([area])[0]?.at).toEqual([1, 1]);
  });

  it('skips stops it cannot read rather than failing', () => {
    expect(questStops([{ id: 'x', title: 'x', kind: 'place', geometry: null }])).toEqual([]);
    expect(questBounds([{ geometry: null }])).toBeUndefined();
  });

  it('draws the suggested route, the shaped stops, passed state and the start', () => {
    const route = {
      id: 'path',
      title: 'Path',
      kind: 'route' as const,
      geometry: {
        type: 'LineString',
        coordinates: [
          [72.882, 19.074],
          [72.883, 19.075]
        ]
      }
    };
    const layers = questMapLayers(
      { checkpoints: [near, route] as never },
      { from: start, passed: new Set(['path']) }
    );
    expect(layers.map((layer) => layer.kind)).toEqual(['quest-route', 'quest-stop', 'route-start']);
    expect(layers[1]?.data.features[0]?.properties).toMatchObject({ passed: true });
    expect(questMapLayers(undefined)).toEqual([]);
  });

  it('frames every stop and the start', () => {
    const [west, south, east, north] = questBounds([near, far], start)!;
    expect(west).toBeLessThan(72.88);
    expect(east).toBeGreaterThan(72.9);
    expect(south).toBeLessThan(19.072);
    expect(north).toBeGreaterThan(19.1);
  });

  it('re-plans a live run from where you are through only the stops still to go', () => {
    const passed = new Set(['near']);
    const here: [number, number] = [72.899, 19.099];
    const pins = liveQuestPins([far, near, middle], passed, here);
    expect(pins.map((pin) => [pin.number, pin.id])).toEqual([
      [1, 'far'],
      [2, 'middle'],
      [3, 'near']
    ]);
    const [route] = questMapLayers(
      { checkpoints: [far, near, middle] as never },
      { from: here, passed, showStart: false }
    );
    const line = route?.data.features[0]?.geometry as { coordinates: number[][] };
    expect(line.coordinates).toEqual([here, [72.9, 19.1], [72.89, 19.085]]);
    expect(
      questMapLayers({ checkpoints: [near] as never }, { from: here, showStart: false }).map(
        (layer) => layer.kind
      )
    ).toEqual(['quest-route']);
  });

  it('counts the time limit from the run start, pauses included', () => {
    const start = Date.UTC(2026, 10, 24, 6, 0);
    expect(questSecondsLeft(undefined, start, start)).toBeUndefined();
    expect(questSecondsLeft(20, undefined, start)).toBeUndefined();
    expect(questSecondsLeft(20, start, start + 5 * 60_000)).toBe(15 * 60);
    expect(questTimeLine(15 * 60 + 7, false)).toBe('15:07 left to pass every stop');
    expect(questTimeLine(-3, false)).toBe("Time's up for this quest. Your run still saves.");
    expect(questTimeLine(30, true)).toBe('Every stop passed in time.');
    expect(questTimeLine(undefined, false)).toBeNull();
    expect(timeLimitLabel(20)).toContain('within 20 min');
    expect(timeLimitLabel(undefined)).toBeNull();
  });
});
