import { describe, expect, it } from 'vitest';
import type { QuestSummary, WeeklyGoalResponse } from '@runsphere/contracts';
import { AuthFailure } from '../auth-failure.js';
import {
  homeErrorState,
  homeStatusMessage,
  questDistanceLabel,
  questListState,
  weeklyGoalMetrics,
  weeklyGoalState
} from './home-state.js';

const weeklyGoal: WeeklyGoalResponse = {
  weekStartsOn: '2026-08-24',
  activeMinutes: { actual: 72, goal: 120 },
  distanceMeters: { actual: 8400, goal: 15000 }
};

const quest: QuestSummary = {
  id: 'quest-1',
  title: 'Fetched quest',
  distanceMeters: 2400,
  estimatedActiveMinutes: 45,
  accessibility: 'step-free',
  openHours: { timezone: 'UTC', schedule: 'Daily', status: 'open' },
  checkpointCount: 3,
  rewardXp: 999
};

describe('Home state model', () => {
  it('renders configured active-minute and distance goal values from the server response', () => {
    expect(weeklyGoalMetrics(weeklyGoal)).toEqual([
      { label: 'Active minutes', actual: '72 min', goal: '120 min', progress: 60 },
      { label: 'Distance', actual: '8.4 km', goal: '15.0 km', progress: 56 }
    ]);
    expect(weeklyGoalState(weeklyGoal)).toBe('ready');
  });

  it('caps progress and rounds a partial metric for an over-goal server response', () => {
    const metrics = weeklyGoalMetrics({
      ...weeklyGoal,
      activeMinutes: { actual: 121, goal: 120 },
      distanceMeters: { actual: 1050, goal: 2000 }
    });
    expect(metrics.map(({ progress }) => progress)).toEqual([100, 53]);
  });

  it('does not create a progress metric when no goal is configured', () => {
    const withoutGoals: WeeklyGoalResponse = {
      ...weeklyGoal,
      activeMinutes: { actual: 72 },
      distanceMeters: { actual: 8400 }
    };
    expect(weeklyGoalMetrics(withoutGoals)).toEqual([]);
    expect(weeklyGoalState(withoutGoals)).toBe('empty');
  });

  it('uses only the fetched quest list and no reward or proximity data', () => {
    expect(questListState([quest])).toBe('ready');
    expect(questListState([])).toBe('empty');
    expect(questDistanceLabel(quest.distanceMeters)).toBe('2.4 km route');
    expect(questDistanceLabel(85)).toBe('85 m route');
    expect(questDistanceLabel(quest.distanceMeters)).not.toMatch(/reward|nearby|xp/i);
  });

  it('keeps configuration, offline, and expired sessions distinct from server-empty data', () => {
    expect(homeErrorState(new AuthFailure('configuration'))).toBe('configuration');
    expect(homeErrorState(new AuthFailure('network'))).toBe('offline');
    expect(homeErrorState(new AuthFailure('invalid-credentials'))).toBe('session-expired');
    expect(homeStatusMessage('configuration', 'loading')).toMatch(/configured/);
    expect(homeStatusMessage('offline', 'ready')).toMatch(/unavailable offline/);
  });
});
