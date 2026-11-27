import type { StyleSpecification } from '@maplibre/maplibre-react-native';
import { gameWorldFor } from '../theme/game-world';

export type MapScheme = 'light' | 'dark';

export interface TurfWorldOptions {
  /** Extruded 3D buildings from street zoom in. On unless the runner turned them off. */
  buildings?: boolean;
}

/** Below this zoom the blocks are too small to read as buildings and only cost frames. */
export const BUILDINGS_MIN_ZOOM = 15;

type StyleLayer = StyleSpecification['layers'][number];

/**
 * The provider's style redrawn as the Turf world: its own vector source and
 * road and label filters, in the night or day palette (ADR-0017), with only the
 * layers a runner needs. Returns undefined for a style it can't read, and the
 * caller falls back to the provider's style untouched.
 */
export function turfWorldStyle(
  style: StyleSpecification,
  scheme: MapScheme = 'dark',
  { buildings = true }: TurfWorldOptions = {}
): StyleSpecification | undefined {
  if (style.version !== 8 || !Array.isArray(style.layers)) return undefined;
  const world = gameWorldFor(scheme);
  const day = scheme === 'light';
  const ground: StyleLayer[] = [];
  const roads: StyleLayer[] = [];
  const labels: StyleLayer[] = [];
  let buildingSource: string | undefined;

  for (const layer of style.layers) {
    if (!('source-layer' in layer)) continue;
    const source = layer['source-layer'];
    if (source === 'building' && 'source' in layer && typeof layer.source === 'string') {
      buildingSource ??= layer.source;
    } else if (layer.type === 'fill' && source === 'water') {
      ground.push({ ...layer, paint: { 'fill-color': world.map.water } });
    } else if (layer.type === 'fill' && source === 'park') {
      ground.push({ ...layer, paint: { 'fill-color': world.map.park, 'fill-opacity': 0.65 } });
    } else if (
      layer.type === 'line' &&
      source === 'transportation' &&
      /motorway|trunk|primary|secondary|tertiary|minor|street|residential/i.test(layer.id) &&
      !/rail|transit|path|ferry/i.test(layer.id)
    ) {
      const minor = /minor|street|residential/.test(layer.id);
      roads.push({
        ...layer,
        paint: {
          ...layer.paint,
          'line-color': /casing/.test(layer.id) ? world.map.roadCasing : world.map.road,
          // White roads on paper need their full weight to read at all.
          'line-opacity': day ? 1 : minor ? 0.45 : 0.8
        }
      });
    } else if (
      layer.type === 'symbol' &&
      source === 'place' &&
      /neighbou?rhood|suburb|quarter|^label_(other|village|town|city|city_capital)$/i.test(layer.id)
    ) {
      labels.push({
        ...layer,
        paint: {
          'text-color': world.map.label,
          'text-halo-color': world.map.night,
          'text-halo-width': 2
        }
      });
    }
  }

  if (!roads.some((layer) => layer.type === 'line')) return undefined;

  // Blocks rise out of the ground as you zoom in, rather than popping up at
  // full height, and sit below the labels so names stay on top.
  const extrusion: StyleLayer[] =
    buildings && buildingSource
      ? [
          {
            id: 'turf-buildings-3d',
            type: 'fill-extrusion',
            source: buildingSource,
            'source-layer': 'building',
            minzoom: BUILDINGS_MIN_ZOOM,
            paint: {
              'fill-extrusion-color': world.map.building,
              'fill-extrusion-height': [
                'interpolate',
                ['linear'],
                ['zoom'],
                BUILDINGS_MIN_ZOOM,
                0,
                BUILDINGS_MIN_ZOOM + 0.6,
                ['coalesce', ['get', 'render_height'], 0]
              ],
              'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
              'fill-extrusion-opacity': day ? 0.85 : 0.75
            }
          }
        ]
      : [];

  return {
    ...style,
    layers: [
      {
        id: 'turf-night-background',
        type: 'background',
        paint: { 'background-color': world.map.night }
      },
      ...ground,
      ...roads,
      ...extrusion,
      ...labels
    ]
  };
}
