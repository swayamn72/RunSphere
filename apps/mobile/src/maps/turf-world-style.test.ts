import { describe, expect, it } from 'vitest';
import type { StyleSpecification } from '@maplibre/maplibre-react-native';
import { gameWorld, gameWorldDay } from '../theme/game-world';
import { BUILDINGS_MIN_ZOOM, turfWorldStyle } from './turf-world-style';

/** The shape of OpenFreeMap's positron: one vector source, buildings, roads, labels. */
const provider = {
  version: 8,
  sources: { openmaptiles: { type: 'vector', url: 'https://tiles.example.com/planet' } },
  layers: [
    { id: 'background', type: 'background', paint: {} },
    { id: 'water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water', paint: {} },
    { id: 'building', type: 'fill', source: 'openmaptiles', 'source-layer': 'building', paint: {} },
    {
      id: 'highway_minor',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      paint: {}
    },
    { id: 'railway', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation' },
    { id: 'label_city', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place' }
  ]
} as unknown as StyleSpecification;

const ids = (style: StyleSpecification | undefined) => style?.layers.map((layer) => layer.id);
const paintOf = (style: StyleSpecification | undefined, id: string) =>
  (style?.layers.find((layer) => layer.id === id) as { paint?: Record<string, unknown> })?.paint;

describe('Turf world style (ADR-0017)', () => {
  it('keeps what a runner needs and drops the rest', () => {
    expect(ids(turfWorldStyle(provider))).toEqual([
      'turf-night-background',
      'water',
      'highway_minor',
      'turf-buildings-3d',
      'label_city'
    ]);
  });

  it('paints night and day from their own palettes', () => {
    const night = turfWorldStyle(provider, 'dark');
    const day = turfWorldStyle(provider, 'light');
    expect(paintOf(night, 'turf-night-background')?.['background-color']).toBe(gameWorld.map.night);
    expect(paintOf(day, 'turf-night-background')?.['background-color']).toBe(
      gameWorldDay.map.night
    );
    expect(paintOf(day, 'water')?.['fill-color']).toBe(gameWorldDay.map.water);
    expect(paintOf(day, 'label_city')?.['text-color']).toBe(gameWorldDay.map.label);
  });

  it('stands buildings up in 3D from street zoom, below the labels', () => {
    const style = turfWorldStyle(provider, 'light');
    const layer = style?.layers.find((entry) => entry.id === 'turf-buildings-3d') as {
      type: string;
      source: string;
      minzoom: number;
    };
    expect(layer.type).toBe('fill-extrusion');
    expect(layer.source).toBe('openmaptiles');
    expect(layer.minzoom).toBe(BUILDINGS_MIN_ZOOM);
    const order = ids(style)!;
    expect(order.indexOf('turf-buildings-3d')).toBeLessThan(order.indexOf('label_city'));
  });

  it('leaves buildings flat when they are turned off or the tiles have none', () => {
    expect(ids(turfWorldStyle(provider, 'dark', { buildings: false }))).not.toContain(
      'turf-buildings-3d'
    );
    const noBuildings = {
      ...provider,
      layers: provider.layers.filter((layer) => layer.id !== 'building')
    } as StyleSpecification;
    expect(ids(turfWorldStyle(noBuildings))).not.toContain('turf-buildings-3d');
  });

  it('gives up on a style it cannot read', () => {
    expect(turfWorldStyle({ version: 7, layers: [] } as unknown as StyleSpecification)).toBe(
      undefined
    );
    const noRoads = {
      ...provider,
      layers: provider.layers.filter((layer) => layer.id !== 'highway_minor')
    } as StyleSpecification;
    expect(turfWorldStyle(noRoads)).toBeUndefined();
  });
});
