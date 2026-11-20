import type { StyleSpecification } from '@maplibre/maplibre-react-native';
import { gameWorld } from '../theme/game-world';

/** Reuse the configured vector source and its existing road and label filters. */
export function turfWorldStyle(style: StyleSpecification): StyleSpecification | undefined {
  if (style.version !== 8 || !Array.isArray(style.layers)) return undefined;
  const layers: StyleSpecification['layers'] = [
    {
      id: 'turf-night-background',
      type: 'background',
      paint: { 'background-color': gameWorld.map.night }
    }
  ];

  for (const layer of style.layers) {
    if (!('source-layer' in layer)) continue;
    const source = layer['source-layer'];
    if (layer.type === 'fill' && source === 'water') {
      layers.push({ ...layer, paint: { 'fill-color': gameWorld.map.water } });
    } else if (layer.type === 'fill' && source === 'park') {
      layers.push({ ...layer, paint: { 'fill-color': gameWorld.map.park, 'fill-opacity': 0.65 } });
    } else if (
      layer.type === 'line' &&
      source === 'transportation' &&
      /motorway|trunk|primary|secondary|tertiary|minor|street|residential/i.test(layer.id) &&
      !/rail|transit|path|ferry/i.test(layer.id)
    ) {
      layers.push({
        ...layer,
        paint: {
          ...layer.paint,
          'line-color': /casing/.test(layer.id) ? gameWorld.map.roadCasing : gameWorld.map.road,
          'line-opacity': /minor|street|residential/.test(layer.id) ? 0.45 : 0.8
        }
      });
    } else if (
      layer.type === 'symbol' &&
      source === 'place' &&
      /neighbou?rhood|suburb|quarter|^label_(other|village|town|city|city_capital)$/i.test(layer.id)
    ) {
      layers.push({
        ...layer,
        paint: {
          'text-color': gameWorld.map.label,
          'text-halo-color': gameWorld.map.night,
          'text-halo-width': 2
        }
      });
    }
  }

  return layers.some((layer) => layer.type === 'line') ? { ...style, layers } : undefined;
}
