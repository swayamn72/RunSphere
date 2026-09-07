import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ROUTE_SUGGESTION_RULE as RULE,
  ROUTE_SUGGESTION_NOTE,
  SUGGESTION_UNAVAILABLE_MESSAGE,
  distanceForMinutes,
  distanceTargetFor,
  estimatedSeconds,
  isDeclineActive,
  isHighLoad,
  rankRoutes,
  routeReason,
  suggestionUnavailableReason,
  type CandidateRoute,
  type RunnerContext
} from './route-suggestion.js';

const NOW = new Date('2026-09-07T06:00:00.000Z');

const route = (overrides: Partial<CandidateRoute> = {}): CandidateRoute => ({
  id: 'route-1',
  familyKey: 'shivaji-park',
  distanceMetres: 3_000,
  startDistanceMetres: 400,
  surface: 'paved',
  lit: true,
  trafficExposure: 'low',
  ...overrides
});

describe('recent load', () => {
  it('is high when the week is half again the usual', () => {
    // `product.md`: ">=150% of the trailing 28-day weekly median".
    expect(isHighLoad({ sevenDayActiveMinutes: 150, trailingWeeklyMedianMinutes: 100 })).toBe(true);
    expect(isHighLoad({ sevenDayActiveMinutes: 149, trailingWeeklyMedianMinutes: 100 })).toBe(
      false
    );
  });

  it('is not high for somebody with no baseline yet', () => {
    // Treating an unknown as high load would pin every new runner to the
    // shortest loop for their first four weeks.
    expect(isHighLoad({ sevenDayActiveMinutes: 300 })).toBe(false);
    expect(isHighLoad({ trailingWeeklyMedianMinutes: 100 })).toBe(false);
    expect(isHighLoad({})).toBe(false);
  });

  it('is not high for somebody who has not run', () => {
    expect(isHighLoad({ sevenDayActiveMinutes: 0, trailingWeeklyMedianMinutes: 100 })).toBe(false);
  });
});

describe('turning a time budget into a distance', () => {
  it('uses the runner own pace when there is one', () => {
    // Half an hour at 5:00/km is 6 km.
    expect(distanceForMinutes(30, { typicalPaceSecondsPerKm: 300 })).toBeCloseTo(6_000, 0);
  });

  it('offers a slower runner less distance for the same half hour', () => {
    // The one place pace is read, and this is why it is not a pace demand: the
    // slower runner is offered a shorter loop, not asked to run faster.
    const quick = distanceForMinutes(30, { typicalPaceSecondsPerKm: 300 });
    const steady = distanceForMinutes(30, { typicalPaceSecondsPerKm: 450 });

    expect(steady).toBeLessThan(quick);
  });

  it('falls back to the published default with no history', () => {
    expect(distanceForMinutes(30, {})).toBeCloseTo(
      (30 * 60 * 1_000) / RULE.defaultPaceSecondsPerKm,
      0
    );
  });

  it('is nothing for a non-positive budget', () => {
    expect(distanceForMinutes(0, {})).toBe(0);
    expect(distanceForMinutes(-10, {})).toBe(0);
  });
});

describe('choosing the distance to aim at', () => {
  const busy: RunnerContext = {
    typicalDistanceMetres: 6_000,
    sevenDayActiveMinutes: 200,
    trailingWeeklyMedianMinutes: 100
  };

  it('honours an explicit distance above everything else', () => {
    // Including above high load. Overriding a direct request in the name of
    // somebody's own good is how an app stops being trusted.
    const target = distanceTargetFor({ targetDistanceMetres: 8_000 }, busy);

    expect(target).toEqual({ targetMetres: 8_000, reason: 'you_asked_for_a_distance' });
  });

  it('honours an explicit time budget above inferred load', () => {
    const target = distanceTargetFor({ targetMinutes: 30 }, busy);

    expect(target.reason).toBe('you_asked_for_a_time');
  });

  it('offers the shortest thing when the week has been heavy', () => {
    const target = distanceTargetFor({}, busy);

    expect(target).toEqual({ targetMetres: RULE.minDistanceMetres, reason: 'high_recent_load' });
  });

  it('otherwise aims at what they usually do', () => {
    const target = distanceTargetFor({}, { typicalDistanceMetres: 6_000 });

    expect(target).toEqual({ targetMetres: 6_000, reason: 'your_usual_distance' });
  });

  it('starts a new runner in the published band', () => {
    const target = distanceTargetFor({}, {});

    // `product.md`: "default new-user suggestion 2-4 km".
    expect(target.reason).toBe('new_runner_default');
    expect(target.targetMetres).toBeGreaterThanOrEqual(RULE.newRunnerBandMetres[0]);
    expect(target.targetMetres).toBeLessThanOrEqual(RULE.newRunnerBandMetres[1]);
  });

  it('clamps to the published 1-10 km range rather than refusing', () => {
    expect(distanceTargetFor({ targetDistanceMetres: 50 }, {}).targetMetres).toBe(
      RULE.minDistanceMetres
    );
    expect(distanceTargetFor({ targetDistanceMetres: 90_000 }, {}).targetMetres).toBe(
      RULE.maxDistanceMetres
    );
    // A four-hour budget is still capped at 10 km.
    expect(distanceTargetFor({ targetMinutes: 240 }, {}).targetMetres).toBe(RULE.maxDistanceMetres);
  });

  it('never aims further than the runner asked for', () => {
    // Rule two of the file: everything resolves downward.
    for (const asked of [1_500, 3_000, 7_000]) {
      expect(
        distanceTargetFor({ targetDistanceMetres: asked }, { typicalDistanceMetres: 9_000 })
          .targetMetres
      ).toBe(asked);
    }
  });
});

describe('a loop somebody passed on', () => {
  it('rests for the published cooldown and then comes back', () => {
    const recent = new Date(NOW.getTime() - 5 * 86_400_000);
    const old = new Date(NOW.getTime() - (RULE.declineCooldownDays + 1) * 86_400_000);

    expect(isDeclineActive(route({ declinedAt: recent }), NOW)).toBe(true);
    // "Not today" is the usual meaning of a decline, so it expires.
    expect(isDeclineActive(route({ declinedAt: old }), NOW)).toBe(false);
  });

  it('is offerable when it was never declined', () => {
    expect(isDeclineActive(route(), NOW)).toBe(false);
  });
});

describe('ranking reviewed loops', () => {
  const target = { targetMetres: 3_000, reason: 'your_usual_distance' as const };

  it('puts the loop nearest the target distance first', () => {
    const ranked = rankRoutes(
      [
        route({ id: 'far', familyKey: 'a', distanceMetres: 8_000 }),
        route({ id: 'near', familyKey: 'b', distanceMetres: 3_200 }),
        route({ id: 'middle', familyKey: 'c', distanceMetres: 5_000 })
      ],
      target,
      {},
      NOW
    );

    expect(ranked.map((entry) => entry.route.id)).toEqual(['near', 'middle', 'far']);
  });

  it('breaks a distance tie by which starts closer', () => {
    const ranked = rankRoutes(
      [
        route({ id: 'walk', familyKey: 'a', distanceMetres: 3_000, startDistanceMetres: 1_200 }),
        route({ id: 'here', familyKey: 'b', distanceMetres: 3_000, startDistanceMetres: 100 })
      ],
      target,
      {},
      NOW
    );

    expect(ranked.map((entry) => entry.route.id)).toEqual(['here', 'walk']);
  });

  it('never shows more than the published maximum', () => {
    const many = Array.from({ length: 10 }, (_unused, index) =>
      route({ id: `r${index}`, familyKey: `f${index}`, distanceMetres: 3_000 + index * 100 })
    );

    expect(rankRoutes(many, target, {}, NOW)).toHaveLength(RULE.maxSuggestions);
  });

  it('offers one loop per family, so three variants of a park is one idea', () => {
    const ranked = rankRoutes(
      [
        route({ id: 'park-short', familyKey: 'park', distanceMetres: 2_900 }),
        route({ id: 'park-long', familyKey: 'park', distanceMetres: 3_100 }),
        route({ id: 'promenade', familyKey: 'promenade', distanceMetres: 4_000 })
      ],
      target,
      {},
      NOW
    );

    expect(ranked.map((entry) => entry.route.familyKey)).toEqual(['park', 'promenade']);
  });

  it('leaves out a loop that starts too far away', () => {
    const ranked = rankRoutes(
      [route({ startDistanceMetres: RULE.startWithinMetres + 1 })],
      target,
      {},
      NOW
    );

    expect(ranked).toEqual([]);
  });

  it('leaves out a loop outside the published distance range', () => {
    const ranked = rankRoutes(
      [
        route({ id: 'tiny', familyKey: 'a', distanceMetres: 500 }),
        route({ id: 'epic', familyKey: 'b', distanceMetres: 20_000 })
      ],
      target,
      {},
      NOW
    );

    expect(ranked).toEqual([]);
  });

  it('leaves out a loop that was declined recently', () => {
    const ranked = rankRoutes(
      [route({ declinedAt: new Date(NOW.getTime() - 86_400_000) })],
      target,
      {},
      NOW
    );

    expect(ranked).toEqual([]);
  });

  it('gives the same three loops for the same request', () => {
    // Somebody deciding between three options must not have them reshuffle
    // under them, so equal candidates fall back to a stable key.
    const candidates = [
      route({ id: 'b', familyKey: 'x', distanceMetres: 3_000 }),
      route({ id: 'a', familyKey: 'y', distanceMetres: 3_000 })
    ];
    const first = rankRoutes(candidates, target, {}, NOW);
    const second = rankRoutes([...candidates].reverse(), target, {}, NOW);

    expect(first.map((entry) => entry.route.id)).toEqual(second.map((entry) => entry.route.id));
  });

  it('never orders by pace, speed, or effort', () => {
    // The load-bearing promise of the product. Two identical loops, one shown
    // to a fast runner and one to a slow runner, come back in the same order.
    const candidates = [
      route({ id: 'a', familyKey: 'a', distanceMetres: 3_000 }),
      route({ id: 'b', familyKey: 'b', distanceMetres: 4_000 })
    ];
    const quick = rankRoutes(candidates, target, { typicalPaceSecondsPerKm: 240 }, NOW);
    const steady = rankRoutes(candidates, target, { typicalPaceSecondsPerKm: 480 }, NOW);

    expect(quick.map((entry) => entry.route.id)).toEqual(steady.map((entry) => entry.route.id));
    // Pace changes only the estimate, which is a courtesy and not a ranking.
    expect(quick[0]!.estimatedSeconds).toBeLessThan(steady[0]!.estimatedSeconds);
  });

  it('reports how far each loop is from the target', () => {
    const ranked = rankRoutes([route({ distanceMetres: 3_400 })], target, {}, NOW);

    expect(ranked[0]!.distanceGapMetres).toBe(400);
  });
});

describe('estimating a time', () => {
  it('uses their own pace, and the default without one', () => {
    expect(estimatedSeconds(5_000, { typicalPaceSecondsPerKm: 300 })).toBe(1_500);
    expect(estimatedSeconds(5_000, {})).toBe(5 * RULE.defaultPaceSecondsPerKm);
  });
});

describe('why a loop is offered', () => {
  it('describes the ground, not the runner', () => {
    const reason = routeReason(
      route({ distanceMetres: 3_200, surface: 'paved', lit: true, trafficExposure: 'none' }),
      { targetMetres: 3_000, reason: 'your_usual_distance' }
    );

    expect(reason).toContain('3.2 km');
    expect(reason).toContain('lit');
    expect(reason).toContain('away from traffic');
    // Never a claim about their ability, and never an instruction.
    expect(reason).not.toMatch(/you should|try to|faster|pace|slow/i);
  });

  it('says plainly when it is shorter because of a heavy week', () => {
    const reason = routeReason(route({ distanceMetres: 1_000 }), {
      targetMetres: 1_000,
      reason: 'high_recent_load'
    });

    expect(reason).toContain('run a lot this week');
  });

  it('warns when a loop crosses traffic', () => {
    expect(
      routeReason(route({ trafficExposure: 'moderate' }), {
        targetMetres: 3_000,
        reason: 'your_usual_distance'
      })
    ).toContain('crosses some traffic');
  });

  it('says a loop is unlit, so somebody can decide about the dark', () => {
    expect(
      routeReason(route({ lit: false }), { targetMetres: 3_000, reason: 'your_usual_distance' })
    ).toContain('unlit');
  });
});

describe('having nothing to suggest', () => {
  const target = { targetMetres: 3_000, reason: 'new_runner_default' as const };

  it('says so when no reviewed loop is anywhere near', () => {
    expect(suggestionUnavailableReason([], [], NOW)).toBe('no_curated_routes');
  });

  it('distinguishes a rested set from an empty one', () => {
    const declined = [route({ declinedAt: new Date(NOW.getTime() - 86_400_000) })];

    expect(suggestionUnavailableReason(declined, rankRoutes(declined, target, {}, NOW), NOW)).toBe(
      'all_declined'
    );
  });

  it('says nothing when there is something to show', () => {
    const candidates = [route()];

    expect(
      suggestionUnavailableReason(candidates, rankRoutes(candidates, target, {}, NOW), NOW)
    ).toBeUndefined();
  });

  it('explains itself without blaming anybody', () => {
    for (const message of Object.values(SUGGESTION_UNAVAILABLE_MESSAGE)) {
      expect(message.length).toBeGreaterThan(40);
      expect(message).not.toMatch(/error|failed|invalid/i);
    }
    // The empty-dataset case has to say why, or it reads as a broken feature.
    expect(SUGGESTION_UNAVAILABLE_MESSAGE.no_curated_routes).toContain('checked by a person');
  });
});

describe('what a suggestion says about itself', () => {
  it('is a guide and says so, with no promise of scoring', () => {
    // `map-ux.md`: "reference only ... no alerts, no penalties for going
    // off-route". A runner who thinks they are scored against a line runs it
    // badly.
    expect(ROUTE_SUGGESTION_NOTE).toContain('not a route to follow');
    expect(ROUTE_SUGGESTION_NOTE).toContain('costs nothing');
    expect(ROUTE_SUGGESTION_NOTE).toContain('never a target');
  });
});
