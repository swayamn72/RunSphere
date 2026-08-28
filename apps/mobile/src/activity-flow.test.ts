import { describe, expect, it } from 'vitest';
import {
  activityFlowReducer,
  activityOriginReturn,
  initialActivityRoute,
  type ActivityOrigin
} from './activity-flow.js';

const quest = {
  id: 'quest-1',
  title: 'River loop',
  distanceMeters: 2_000,
  estimatedActiveMinutes: 30,
  checkpointCount: 3,
  accessibility: 'step-free' as const,
  openHours: { timezone: 'UTC', schedule: 'Always', status: 'open' as const }
};

describe('activity flow', () => {
  it('keeps the free-activity origin explicit through preparation and live states', () => {
    const prepare = activityFlowReducer(initialActivityRoute, {
      type: 'start-free',
      origin: { kind: 'explore' }
    });
    expect(prepare).toEqual({ screen: 'prepare', origin: { kind: 'explore' } });
    expect(activityFlowReducer(prepare, { type: 'recording-active' })).toEqual({
      screen: 'live',
      origin: { kind: 'explore' }
    });
  });

  it('synchronizes a recovered durable session to Live using a safe Home return origin', () => {
    expect(
      activityFlowReducer(initialActivityRoute, {
        type: 'restore-recording',
        origin: { kind: 'home' }
      })
    ).toEqual({ screen: 'live', origin: { kind: 'home' } });
  });

  it('restores the selected quest detail instead of silently returning Home', () => {
    const origin: ActivityOrigin = { kind: 'quest-detail', quest };
    expect(activityOriginReturn(origin)).toEqual({ activeTab: 'Explore', selectedQuest: quest });
  });

  it('clears transient activity state on tab changes, logout, and exit', () => {
    const route = { screen: 'prepare' as const, origin: { kind: 'home' as const } };
    expect(activityFlowReducer(route, { type: 'select-tab' })).toEqual(initialActivityRoute);
    expect(activityFlowReducer(route, { type: 'logout' })).toEqual(initialActivityRoute);
    expect(activityFlowReducer(route, { type: 'exit' })).toEqual(initialActivityRoute);
  });
});
