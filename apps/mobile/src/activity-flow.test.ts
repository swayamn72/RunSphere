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
  it('keeps the origin explicit through preparation and live states', () => {
    const prepare = activityFlowReducer(initialActivityRoute, {
      type: 'start-run',
      origin: { kind: 'quests' },
      start: { mode: 'free' }
    });
    expect(prepare).toEqual({
      screen: 'prepare',
      origin: { kind: 'quests' },
      start: { mode: 'free' }
    });
    expect(activityFlowReducer(prepare, { type: 'recording-active' })).toEqual({
      screen: 'live',
      origin: { kind: 'quests' }
    });
  });

  it('carries the chosen mode and its target to the prepare screen', () => {
    expect(
      activityFlowReducer(initialActivityRoute, {
        type: 'start-run',
        origin: { kind: 'quest-detail', quest },
        start: { mode: 'quest', questId: quest.id }
      })
    ).toEqual({
      screen: 'prepare',
      origin: { kind: 'quest-detail', quest },
      start: { mode: 'quest', questId: 'quest-1' }
    });
    expect(
      activityFlowReducer(initialActivityRoute, {
        type: 'start-run',
        origin: { kind: 'map' },
        start: { mode: 'ghost', ghostClaimId: 'claim-1' }
      })
    ).toMatchObject({ start: { mode: 'ghost', ghostClaimId: 'claim-1' } });
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
    expect(activityOriginReturn(origin)).toEqual({
      activeTab: 'Home',
      focus: 'quests',
      selectedQuest: quest
    });
  });

  it('returns a zone-map run to the map, where the claim it was chasing is', () => {
    expect(activityOriginReturn({ kind: 'map' })).toEqual({ activeTab: 'Map', focus: 'none' });
    expect(activityOriginReturn({ kind: 'home' })).toEqual({ activeTab: 'Home', focus: 'none' });
  });

  it('clears transient activity state on tab changes, logout, and exit', () => {
    const route = {
      screen: 'prepare' as const,
      origin: { kind: 'home' as const },
      start: { mode: 'turf' as const }
    };
    expect(activityFlowReducer(route, { type: 'select-tab' })).toEqual(initialActivityRoute);
    expect(activityFlowReducer(route, { type: 'logout' })).toEqual(initialActivityRoute);
    expect(activityFlowReducer(route, { type: 'exit' })).toEqual(initialActivityRoute);
  });
});
