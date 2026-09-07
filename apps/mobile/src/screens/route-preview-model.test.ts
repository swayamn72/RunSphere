import { describe, expect, it } from 'vitest';
import type { RouteSuggestion, RouteSuggestionResponse } from '@runsphere/contracts';
import { AuthFailure } from '../auth-failure';
import {
  MAX_TARGET_METRES,
  MIN_TARGET_METRES,
  ROUTE_GUIDE_CAPTION,
  canStepTarget,
  clampSelectedIndex,
  formatRouteEstimate,
  formatStartDistance,
  loopCentre,
  parseMinutesInput,
  routeFacts,
  routeGuideFrom,
  routeGuideLayers,
  routePreviewCards,
  routePreviewErrorStateFor,
  routePreviewLayers,
  routePreviewStateFor,
  stepTargetMetres,
  targetReasonMessage,
  unavailableMessage
} from './route-preview-model.js';

/** A closed square loop, so `path[0] === path.at(-1)` as the contract requires. */
const loop = (overrides: Partial<RouteSuggestion> = {}): RouteSuggestion => ({
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Shivaji Park Loop',
  // `CoordinateSchema` is [longitude, latitude].
  path: [
    [72.838, 19.028],
    [72.842, 19.028],
    [72.842, 19.032],
    [72.838, 19.032],
    [72.838, 19.028]
  ],
  start: [72.838, 19.028],
  distanceMetres: 3_000,
  startDistanceMetres: 240,
  estimatedSeconds: 1_080,
  surface: 'paved',
  lit: true,
  trafficExposure: 'low',
  accessibility: 'step-free',
  reason: 'Close to you, about your usual distance',
  ...overrides
});

const response = (overrides: Partial<RouteSuggestionResponse> = {}): RouteSuggestionResponse => ({
  data: [loop()],
  targetDistanceMetres: 3_000,
  targetReason: 'your_usual_distance',
  note: 'A guide, not a course.',
  ...overrides
});

describe('size labels', () => {
  it('names three well-separated loops Short, Medium and Long', () => {
    const cards = routePreviewCards([
      loop({ distanceMetres: 5_000 }),
      loop({ distanceMetres: 2_000 }),
      loop({ distanceMetres: 3_500 })
    ]);

    expect(cards.map((card) => card.sizeLabel)).toEqual(['Short', 'Medium', 'Long']);
    expect(cards.map((card) => card.suggestion.distanceMetres)).toEqual([2_000, 3_500, 5_000]);
  });

  it('withholds the words when the loops are all the same run', () => {
    // 3.9, 4.0 and 4.1 km. Calling the first "Short" is a claim the runner
    // finds out is false about a kilometre in.
    const cards = routePreviewCards([
      loop({ distanceMetres: 3_900 }),
      loop({ distanceMetres: 4_000 }),
      loop({ distanceMetres: 4_100 })
    ]);

    expect(cards.every((card) => card.sizeLabel === undefined)).toBe(true);
    // The distance on each card is what tells them apart instead.
    expect(cards.map((card) => card.distanceLabel)).toEqual(['3.9 km', '4 km', '4.1 km']);
  });

  it('says Shorter and Longer when there are two', () => {
    const cards = routePreviewCards([
      loop({ distanceMetres: 6_000 }),
      loop({ distanceMetres: 2_000 })
    ]);

    expect(cards.map((card) => card.sizeLabel)).toEqual(['Shorter', 'Longer']);
  });

  it('labels nothing when there is only one', () => {
    expect(routePreviewCards([loop()])[0]?.sizeLabel).toBeUndefined();
  });

  it('keeps server order for equal distances, so a reload does not reshuffle', () => {
    const first = loop({ id: '22222222-2222-4222-8222-222222222222', distanceMetres: 4_000 });
    const second = loop({ id: '33333333-3333-4333-8333-333333333333', distanceMetres: 4_000 });

    expect(routePreviewCards([first, second]).map((card) => card.suggestion.id)).toEqual([
      first.id,
      second.id
    ]);
  });
});

describe('what a card says', () => {
  it('presents the time as an estimate, never a target', () => {
    // `RouteSuggestionSchema` requires this of the app in so many words.
    expect(formatRouteEstimate(1_080)).toBe('About 18 min');
    expect(formatRouteEstimate(20)).toBe('About 1 min');
  });

  it('leads with lighting, and says so when a route is unlit', () => {
    expect(routeFacts(loop({ lit: false }))[0]).toBe('Unlit');
    expect(routeFacts(loop({ lit: true }))[0]).toBe('Lit');
  });

  it('never leaves accessibility or traffic unstated', () => {
    const facts = routeFacts(loop({ accessibility: 'unknown', trafficExposure: 'moderate' }));

    expect(facts).toContain('Steps unknown');
    expect(facts).toContain('Some traffic');
  });

  it('describes how far the start is in words a runner uses', () => {
    expect(formatStartDistance(40)).toBe('Starts where you are');
    expect(formatStartDistance(240)).toBe('Starts 240 m away');
    expect(formatStartDistance(1_320)).toBe('Starts 1.3 km away');
  });
});

describe('why this distance', () => {
  it('explains a deliberately shorter set', () => {
    const message = targetReasonMessage(
      response({ targetReason: 'high_recent_load', targetDistanceMetres: 2_500 })
    );

    expect(message).toContain('run a lot this week');
    expect(message).toContain('2.5 km');
  });

  it('has words for every reason the contract allows', () => {
    const reasons: readonly RouteSuggestionResponse['targetReason'][] = [
      'you_asked_for_a_distance',
      'you_asked_for_a_time',
      'high_recent_load',
      'your_usual_distance',
      'new_runner_default'
    ];

    for (const targetReason of reasons) {
      expect(targetReasonMessage(response({ targetReason }))).toMatch(/\S/);
    }
  });
});

describe('adjusting the distance', () => {
  it('rounds toward the direction pressed', () => {
    // 3,847 m is the sort of number "your usual distance" produces.
    expect(stepTargetMetres(3_847, 'up')).toBe(4_000);
    expect(stepTargetMetres(3_847, 'down')).toBe(3_500);
  });

  it('moves a whole step off an exact multiple', () => {
    expect(stepTargetMetres(4_000, 'up')).toBe(4_500);
    expect(stepTargetMetres(4_000, 'down')).toBe(3_500);
  });

  it('stays inside the published 1-10 km range', () => {
    expect(stepTargetMetres(MAX_TARGET_METRES, 'up')).toBe(MAX_TARGET_METRES);
    expect(stepTargetMetres(MIN_TARGET_METRES, 'down')).toBe(MIN_TARGET_METRES);
    expect(canStepTarget(MAX_TARGET_METRES, 'up')).toBe(false);
    expect(canStepTarget(MIN_TARGET_METRES, 'down')).toBe(false);
    expect(canStepTarget(MAX_TARGET_METRES, 'down')).toBe(true);
  });

  it('lets an out-of-range starting point back into range', () => {
    // Nothing should produce this, but a control that refuses to move is worse
    // than one that corrects.
    expect(stepTargetMetres(12_000, 'down')).toBe(MAX_TARGET_METRES);
    expect(stepTargetMetres(400, 'up')).toBe(MIN_TARGET_METRES);
  });
});

describe('the minutes input', () => {
  it('accepts a whole number of minutes', () => {
    expect(parseMinutesInput(' 30 ')).toEqual({ minutes: 30 });
  });

  it('refuses rather than clamps, so nobody is shown a run they did not ask for', () => {
    expect(parseMinutesInput('9000')).toEqual({ error: 'Enter between 1 and 600 minutes.' });
    expect(parseMinutesInput('0')).toEqual({ error: 'Enter between 1 and 600 minutes.' });
  });

  it('refuses anything that is not a plain number', () => {
    for (const text of ['', 'half an hour', '30m', '2.5', '-5']) {
      expect(parseMinutesInput(text)).toHaveProperty('error');
    }
  });
});

describe('when there is nothing to show', () => {
  it('distinguishes an empty dataset from a runner who keeps declining', () => {
    expect(
      unavailableMessage(response({ data: [], unavailableReason: 'no_curated_routes' }))
    ).toContain('No reviewed routes near you yet');
    expect(unavailableMessage(response({ data: [], unavailableReason: 'all_declined' }))).toContain(
      'passed on the routes near you'
    );
  });

  it('says the run counts either way', () => {
    expect(unavailableMessage(response({ data: [] }))).toContain('counts the same');
  });

  it('reads an empty answer as empty, not as an error', () => {
    expect(routePreviewStateFor(response({ data: [] }))).toBe('empty');
    expect(routePreviewStateFor(response())).toBe('ready');
  });

  it('separates being offline from being broken', () => {
    expect(routePreviewErrorStateFor(new AuthFailure('network'))).toBe('offline');
    expect(routePreviewErrorStateFor(new AuthFailure('invalid-credentials'))).toBe(
      'session-expired'
    );
    expect(routePreviewErrorStateFor(new Error('boom'))).toBe('error');
  });
});

describe('the map layers', () => {
  it('draws the loop solid on the preview, where it is the subject', () => {
    const [line, start] = routePreviewLayers(loop());

    expect(line?.kind).toBe('line');
    expect(start?.kind).toBe('circle');
  });

  it('draws the same loop as a guide on the live map', () => {
    // The live trace is `line`. A guide that shared its paint would read as a
    // course the runner is being held to.
    const [guide] = routeGuideLayers(routeGuideFrom(loop()));

    expect(guide?.kind).toBe('guide');
    expect(guide?.id).toBe('route-guide');
  });

  it('draws nothing when no route was accepted', () => {
    expect(routeGuideLayers(undefined)).toEqual([]);
  });

  it('writes coordinates longitude first, as GeoJSON requires', () => {
    const [line] = routePreviewLayers(loop());
    const geometry = line!.data.features[0]!.geometry;

    expect(geometry.type).toBe('LineString');
    // Mumbai: longitude ~72.8, latitude ~19.0. Swapped, this lands in Somalia.
    expect((geometry as { coordinates: number[][] }).coordinates[0]).toEqual([72.838, 19.028]);
  });

  it('centres the preview on the loop rather than on the runner', () => {
    expect(loopCentre(loop())).toEqual([72.84, 19.03]);
  });
});

describe('what crosses into the run', () => {
  it('carries the line and the identity, and drops the persuasion', () => {
    const guide = routeGuideFrom(loop());

    expect(guide).toEqual({
      routeId: loop().id,
      name: 'Shivaji Park Loop',
      distanceMetres: 3_000,
      path: loop().path
    });
    // The estimate and the reason were about a decision already taken.
    expect(guide).not.toHaveProperty('estimatedSeconds');
    expect(guide).not.toHaveProperty('reason');
  });

  it('has a caption that keeps the line from reading as a course', () => {
    expect(ROUTE_GUIDE_CAPTION).toContain('not a course');
  });
});

describe('selection', () => {
  it('stays in range as the set changes under it', () => {
    expect(clampSelectedIndex(3, 5)).toBe(2);
    expect(clampSelectedIndex(3, -1)).toBe(0);
    expect(clampSelectedIndex(0, 2)).toBe(0);
  });
});
