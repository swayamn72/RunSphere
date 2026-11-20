import type { StyleSpecification } from '@maplibre/maplibre-react-native';

/** Reuse the configured vector source and its existing road and label filters. */
export function turfWorldStyle(style: StyleSpecification): StyleSpecification | undefined {
  if (style.version !== 8 || !Array.isArray(style.layers)) return undefined;
  const layers: StyleSpecification['layers'] = [
    { id: 'turf-night-background', type: 'background', paint: { 'background-color': '#090f25' } }
  ];

  for (const layer of style.layers) {
    if (!('source-layer' in layer)) continue;
    const source = layer['source-layer'];
    if (layer.type === 'fill' && source === 'water') {
      layers.push({ ...layer, paint: { 'fill-color': '#142f53' } });
    } else if (layer.type === 'fill' && source === 'park') {
      layers.push({ ...layer, paint: { 'fill-color': '#123132', 'fill-opacity': 0.65 } });
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
          'line-color': /casing/.test(layer.id) ? '#263661' : '#516a9c',
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
          'text-color': '#d1e2f7',
          'text-halo-color': '#090f25',
          'text-halo-width': 2
        }
      });
    }
  }

  return layers.some((layer) => layer.type === 'line') ? { ...style, layers } : undefined;
}
