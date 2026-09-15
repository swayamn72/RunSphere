import type { QuestSummary } from '@runsphere/contracts';
import type { Tab } from './navigation/types';

export type ActivityOrigin =
  | { readonly kind: 'home' }
  /** Started from the quest catalogue, which opens over Home rather than owning a tab. */
  | { readonly kind: 'quests' }
  /**
   * Started from the zone map — including a Ghost Race, which begins by
   * tapping somebody's ground. Its own origin rather than reusing `home`
   * because the map is where the result matters: somebody who has just run a
   * loop to take a claim wants to see the claim, not the Home tab.
   */
  | { readonly kind: 'map' }
  | { readonly kind: 'quest-detail'; readonly quest: QuestSummary };

/**
 * A surface that opens over a tab and owns its own back affordance: the
 * challenge list, the quest catalogue, and the route suggestions. Held apart
 * from `Tab` because none of these appear in the five-tab bar, and returning
 * from a run has to restore the one the run was started from.
 */
export type FocusedSurface = 'none' | 'challenges' | 'quests' | 'route-preview';

export type ActivityRoute =
  | { readonly screen: 'idle' }
  | { readonly screen: 'prepare'; readonly origin: ActivityOrigin }
  | { readonly screen: 'live'; readonly origin: ActivityOrigin }
  | { readonly screen: 'result'; readonly origin: ActivityOrigin };

export const initialActivityRoute: ActivityRoute = { screen: 'idle' };

export type ActivityFlowEvent =
  | { readonly type: 'start-free'; readonly origin: ActivityOrigin }
  | { readonly type: 'recording-active' }
  | { readonly type: 'recording-finished' }
  | { readonly type: 'restore-recording'; readonly origin: ActivityOrigin }
  | { readonly type: 'exit' }
  | { readonly type: 'select-tab' }
  | { readonly type: 'logout' };

/** Keeps the activity destination and its return target independent of tab selection. */
export const activityFlowReducer = (
  route: ActivityRoute,
  event: ActivityFlowEvent
): ActivityRoute => {
  if (event.type === 'start-free') return { screen: 'prepare', origin: event.origin };
  if (event.type === 'select-tab' || event.type === 'logout' || event.type === 'exit')
    return initialActivityRoute;
  if (event.type === 'restore-recording') return { screen: 'live', origin: event.origin };
  if (event.type === 'recording-active' && route.screen === 'prepare')
    return { screen: 'live', origin: route.origin };
  if (event.type === 'recording-finished' && route.screen === 'live')
    return { screen: 'result', origin: route.origin };
  return route;
};

/**
 * Where finishing or abandoning a run puts the reader back.
 *
 * A quest run returns to the quest, not to the tab underneath it: somebody who
 * ran a checkpoint loop wants to see what the loop did to that quest.
 */
export const activityOriginReturn = (
  origin: ActivityOrigin
): {
  activeTab: Tab;
  focus: FocusedSurface;
  selectedQuest?: QuestSummary;
} => {
  if (origin.kind === 'quest-detail')
    return { activeTab: 'Home', focus: 'quests', selectedQuest: origin.quest };
  if (origin.kind === 'quests') return { activeTab: 'Home', focus: 'quests' };
  if (origin.kind === 'map') return { activeTab: 'Map', focus: 'none' };
  return { activeTab: 'Home', focus: 'none' };
};

export const routeOrigin = (route: ActivityRoute): ActivityOrigin | undefined =>
  route.screen === 'idle' ? undefined : route.origin;
