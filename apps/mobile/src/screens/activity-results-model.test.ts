import { describe, expect, it } from 'vitest';
import {
  activityHistoryLabel,
  activityHistoryMetric,
  activityResultPresentation,
  calculatedPace,
  derivedResultRouteLayers,
  derivedRouteCenter,
  validDerivedRouteGeometry
} from './activity-results-model.js';

const derived = {
  status: 'derived' as const,
  summary: {
    distanceMeters: 1_000,
    durationSeconds: 330,
    pointCount: 2,
    rejectedPointCount: 0,
    rejectedGapCount: 0,
    privacyTrimmed: true
  },
  geometry: {
    type: 'LineString' as const,
    coordinates: [
      [72.877, 19.076],
      [72.878, 19.077]
    ]
  }
};

describe('activity Results presentation', () => {
  it.each(['received', 'validating', 'accepted'] as const)('keeps %s pending', (status) => {
    expect(activityResultPresentation({ status }).state).toBe('pending');
  });

  it('does not infer validated Results from local state or an absent server detail', () => {
    expect(activityResultPresentation(undefined)).toEqual({ state: 'pending' });
    expect(activityResultPresentation({ status: 'derived' })).toEqual({ state: 'pending' });
    expect(activityHistoryLabel(undefined)).toBe('Pending server validation');
  });

  it('renders totals and renderer-local geometry only from a valid derived server response', () => {
    const presentation = activityResultPresentation(derived);
    expect(presentation.state).toBe('validated');
    expect(derivedResultRouteLayers(presentation)).toHaveLength(1);
    expect(calculatedPace(derived.summary)).toBe('5:30');
  });

  it('reduces large derived geometry before calculating a render center', () => {
    const line = Array.from({ length: 10_000 }, (_, index) => [index, index / 2]);
    expect(derivedRouteCenter({ type: 'LineString', coordinates: line })).toEqual([
      4999.5, 2499.75
    ]);
  });

  it('does not create a map for rejected, null, malformed, or non-derived geometry', () => {
    expect(activityResultPresentation({ status: 'rejected' }).state).toBe('rejected');
    expect(activityResultPresentation(undefined, 'rejected').state).toBe('rejected');
    expect(activityResultPresentation(undefined, 'deleted').state).toBe('deleted');
    expect(validDerivedRouteGeometry(null)).toBeUndefined();
    expect(
      validDerivedRouteGeometry({ type: 'Point', coordinates: [72.877, 19.076] })
    ).toBeUndefined();
    expect(
      validDerivedRouteGeometry({ type: 'LineString', coordinates: [[72.877], [72.878]] })
    ).toBeUndefined();
    expect(
      derivedResultRouteLayers(activityResultPresentation({ ...derived, geometry: null }))
    ).toEqual([]);
    expect(derivedResultRouteLayers(activityResultPresentation({ status: 'accepted' }))).toEqual(
      []
    );
  });

  it('keeps local history distance provisional until a fetched derived summary is available', () => {
    const session = { distanceMeters: 300, remoteStatus: 'derived' as const };
    expect(activityHistoryMetric(session, undefined)).toEqual({
      distanceMeters: 300,
      detail: 'Provisional local distance'
    });
    expect(activityHistoryMetric(session, derived)).toEqual({
      distanceMeters: 1_000,
      detail: 'Validated distance'
    });
  });

  it('labels rejection non-punitively and lifecycle metadata as not-yet-fetched truth', () => {
    expect(activityHistoryLabel('rejected')).toBe(
      'Saved privately — not eligible for validated totals'
    );
    expect(activityHistoryLabel('derived')).toBe('Validated totals refresh when connected');
  });
});
