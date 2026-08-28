import { describe, expect, it } from 'vitest';
import type { QuestDetail, QuestSummary } from '@runsphere/contracts';
import { ApiFailure } from '../api-client.js';
import { AuthFailure } from '../auth-failure.js';
import {
  acceptsCatalogResponse,
  catalogErrorStateFor,
  detailStateFor,
  filterQuests,
  initialQuestFilters,
  nextCatalogRequestPlan,
  selectedCheckpointLayers,
  selectedDetailInitialCenter,
  shouldDrawSelectedGeometry
} from './explore-model.js';

const openQuest: QuestSummary = {
  id: 'open',
  title: 'Open step-free quest',
  distanceMeters: 2400,
  estimatedActiveMinutes: 25,
  accessibility: 'step-free',
  openHours: { timezone: 'UTC', schedule: 'Daily', status: 'open' },
  checkpointCount: 2
};
const limitedQuest: QuestSummary = {
  ...openQuest,
  id: 'limited',
  title: 'Limited quest',
  estimatedActiveMinutes: 45,
  accessibility: 'mixed',
  openHours: { ...openQuest.openHours, status: 'limited' }
};
const closedQuest: QuestSummary = {
  ...openQuest,
  id: 'closed',
  title: 'Closed quest',
  estimatedActiveMinutes: 75,
  accessibility: 'mixed',
  openHours: { ...openQuest.openHours, status: 'closed' }
};
const detail: QuestDetail = {
  ...openQuest,
  sourceReviewedAt: '2026-08-28T00:00:00.000Z',
  checkpoints: [
    {
      id: '00000000-0000-4000-8000-000000000001',
      kind: 'place',
      title: 'First place',
      geometryVersion: 1,
      geometry: { type: 'Point', coordinates: [72.8, 19.1] },
      accessibility: 'step-free',
      openHours: openQuest.openHours
    },
    {
      id: '00000000-0000-4000-8000-000000000002',
      kind: 'route',
      title: 'Display geometry',
      geometryVersion: 1,
      geometry: {
        type: 'LineString',
        coordinates: [
          [72.8, 19.1],
          [72.81, 19.11]
        ]
      },
      accessibility: 'step-free',
      openHours: openQuest.openHours
    }
  ]
};

describe('Explore catalog model', () => {
  it('uses only exposed status, accessibility, and active-time filters without changing catalog order', () => {
    const catalog = [openQuest, limitedQuest, closedQuest];
    expect(filterQuests(catalog, initialQuestFilters)).toEqual(catalog);
    expect(filterQuests(catalog, { ...initialQuestFilters, open: 'limited' })).toEqual([
      limitedQuest
    ]);
    expect(filterQuests(catalog, { ...initialQuestFilters, open: 'closed' })).toEqual([
      closedQuest
    ]);
    expect(filterQuests(catalog, { ...initialQuestFilters, accessibility: 'step-free' })).toEqual([
      openQuest
    ]);
    expect(filterQuests(catalog, { ...initialQuestFilters, time: 'under-30' })).toEqual([
      openQuest
    ]);
    expect(filterQuests(catalog, { ...initialQuestFilters, time: '30-to-60' })).toEqual([
      limitedQuest
    ]);
  });

  it('keeps offline, configuration, expiry, unavailable, error, and closed states distinct', () => {
    expect(catalogErrorStateFor(new AuthFailure('network'))).toBe('offline');
    expect(catalogErrorStateFor(new AuthFailure('configuration'))).toBe('configuration');
    expect(catalogErrorStateFor(new AuthFailure('invalid-credentials'))).toBe('session-expired');
    expect(detailStateFor(openQuest, undefined, new ApiFailure(404, 'missing'))).toBe(
      'unavailable'
    );
    expect(detailStateFor(closedQuest, undefined, new ApiFailure(500, 'failed'))).toBe('error');
    expect(detailStateFor(closedQuest, undefined, undefined)).toBe('closed');
  });

  it('does not create detail geometry before selection, centers from the first published coordinate, and hides geometry on errors', () => {
    expect(selectedCheckpointLayers(undefined)).toEqual([]);
    expect(selectedDetailInitialCenter(detail)).toEqual([72.8, 19.1]);
    expect(selectedCheckpointLayers(detail).map((layer) => layer.kind)).toEqual(['line', 'circle']);
    expect(shouldDrawSelectedGeometry('ready')).toBe(true);
    expect(shouldDrawSelectedGeometry('closed')).toBe(true);
    expect(shouldDrawSelectedGeometry('error')).toBe(false);
    expect(shouldDrawSelectedGeometry('unavailable')).toBe(false);
  });

  it('accepts only the current catalog request generation, preventing stale or unmounted responses', () => {
    const request = nextCatalogRequestPlan(3);
    expect(acceptsCatalogResponse(request, 4)).toBe(true);
    expect(acceptsCatalogResponse(request, 5)).toBe(false);
    expect(acceptsCatalogResponse({ ...request, active: false }, 4)).toBe(false);
  });
});
