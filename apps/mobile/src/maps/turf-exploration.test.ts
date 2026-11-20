import { expect, it } from 'vitest';
import { addExploredSamples, fogFeatures } from './turf-exploration';
import type { RecordedLocationSample } from '../activity-recorder-core';

it('clears only cells visited by usable local observations', () => {
  const visited = new Set<string>();
  const point: RecordedLocationSample = {
    longitude: 0.0005,
    latitude: 0.0005,
    recordedAt: '2026-11-21T00:00:00Z',
    accuracy: 8,
    altitude: null,
    disposition: 'usable',
    segmentBreak: false
  };
  addExploredSamples(visited, [
    point,
    { ...point, longitude: 0.002, disposition: 'weak-accuracy' }
  ]);
  const fog = fogFeatures({ west: 0, east: 0.003, south: 0, north: 0.0015 }, visited);
  expect(fog.features).toHaveLength(1);
  expect(fog.features[0]?.geometry.coordinates[0]?.[0]).toEqual([0.0015, 0]);
});
