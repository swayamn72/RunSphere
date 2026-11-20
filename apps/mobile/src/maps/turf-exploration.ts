import type { TerritoryClaimBounds } from '@runsphere/contracts';
import type { FeatureCollection, Polygon } from 'geojson';
import type { RecordedLocationSample } from '../activity-recorder-core';

const CELL = 0.0015;
const key = (x: number, y: number) => `${x},${y}`;

export const explorationCell = (longitude: number, latitude: number): string =>
  key(Math.floor(longitude / CELL), Math.floor(latitude / CELL));

export function addExploredSamples(cells: Set<string>, samples: readonly RecordedLocationSample[]) {
  for (const sample of samples) {
    if (
      sample.disposition === 'usable' ||
      sample.disposition === 'gap-anchor' ||
      sample.disposition === 'resume-anchor'
    ) {
      cells.add(explorationCell(sample.longitude, sample.latitude));
    }
  }
}

/** Merge consecutive unexplored cells into strips and skip wide views. */
export function fogFeatures(
  bounds: TerritoryClaimBounds | undefined,
  visited: ReadonlySet<string> | undefined
): FeatureCollection<Polygon> {
  const features: FeatureCollection<Polygon>['features'] = [];
  if (!bounds || !visited) return { type: 'FeatureCollection', features };
  const west = Math.floor(bounds.west / CELL);
  const east = Math.ceil(bounds.east / CELL);
  const south = Math.floor(bounds.south / CELL);
  const north = Math.ceil(bounds.north / CELL);
  if (east <= west || north <= south || east - west > 200 || north - south > 200)
    return { type: 'FeatureCollection', features };
  for (let y = south; y < north; y += 1) {
    let start = west;
    for (let x = west; x <= east; x += 1) {
      if (x < east && !visited.has(key(x, y))) continue;
      if (x > start) {
        const l = Math.max(-180, start * CELL);
        const r = Math.min(180, x * CELL);
        const b = Math.max(-90, y * CELL);
        const t = Math.min(90, (y + 1) * CELL);
        features.push({
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [l, b],
                [r, b],
                [r, t],
                [l, t],
                [l, b]
              ]
            ]
          }
        });
      }
      start = x + 1;
    }
  }
  return { type: 'FeatureCollection', features };
}
