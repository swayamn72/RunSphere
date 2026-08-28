import type { QuestSummary, WeeklyGoalResponse } from '@runsphere/contracts';
import { AuthFailure } from '../auth-failure';

export type HomeRemoteState =
  'loading' | 'ready' | 'empty' | 'offline' | 'error' | 'configuration' | 'session-expired';

export interface WeeklyGoalMetric {
  readonly label: 'Active minutes' | 'Distance';
  readonly actual: string;
  readonly goal: string;
  readonly progress: number;
}

const goalProgress = (actual: number, goal: number): number =>
  Math.min(100, Math.round((actual / goal) * 100));

/** Only configured server goals produce Home metrics; queued local activity is never an input. */
export const weeklyGoalMetrics = (goal: WeeklyGoalResponse): readonly WeeklyGoalMetric[] => {
  const metrics: WeeklyGoalMetric[] = [];
  if (goal.activeMinutes.goal)
    metrics.push({
      label: 'Active minutes',
      actual: `${goal.activeMinutes.actual} min`,
      goal: `${goal.activeMinutes.goal} min`,
      progress: goalProgress(goal.activeMinutes.actual, goal.activeMinutes.goal)
    });
  if (goal.distanceMeters.goal)
    metrics.push({
      label: 'Distance',
      actual: `${(goal.distanceMeters.actual / 1000).toFixed(1)} km`,
      goal: `${(goal.distanceMeters.goal / 1000).toFixed(1)} km`,
      progress: goalProgress(goal.distanceMeters.actual, goal.distanceMeters.goal)
    });
  return metrics;
};

export const weeklyGoalState = (goal: WeeklyGoalResponse): HomeRemoteState =>
  weeklyGoalMetrics(goal).length ? 'ready' : 'empty';

export const questListState = (quests: readonly QuestSummary[]): HomeRemoteState =>
  quests.length ? 'ready' : 'empty';

export const homeErrorState = (error: unknown): HomeRemoteState => {
  if (!(error instanceof AuthFailure)) return 'error';
  if (error.kind === 'configuration') return 'configuration';
  if (error.kind === 'invalid-credentials') return 'session-expired';
  if (error.kind === 'network' || error.kind === 'tls') return 'offline';
  return 'error';
};

export const questDistanceLabel = (distanceMeters: number): string =>
  distanceMeters < 100
    ? `${Math.round(distanceMeters)} m route`
    : `${(distanceMeters / 1000).toFixed(1)} km route`;

export const homeStatusMessage = (
  goalState: HomeRemoteState,
  questState: HomeRemoteState
): string => {
  if (goalState === 'configuration' || questState === 'configuration')
    return 'Home data is unavailable until RunSphere is configured.';
  if (goalState === 'loading' || questState === 'loading') return 'Refreshing Home data.';
  if (goalState === 'offline' || questState === 'offline')
    return 'Some Home data is unavailable offline.';
  if (goalState === 'error' || questState === 'error') return 'Some Home data is unavailable.';
  return '';
};
