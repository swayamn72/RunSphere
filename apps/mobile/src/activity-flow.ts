import type { QuestSummary } from '@runsphere/contracts';
import type { Tab } from './navigation/types';

export type ActivityOrigin =
  | { readonly kind: 'home' }
  | { readonly kind: 'explore' }
  | { readonly kind: 'quest-detail'; readonly quest: QuestSummary };

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

export const activityOriginReturn = (
  origin: ActivityOrigin
): {
  activeTab: Tab;
  selectedQuest?: QuestSummary;
} =>
  origin.kind === 'quest-detail'
    ? { activeTab: 'Explore', selectedQuest: origin.quest }
    : { activeTab: origin.kind === 'home' ? 'Home' : 'Explore' };

export const routeOrigin = (route: ActivityRoute): ActivityOrigin | undefined =>
  route.screen === 'idle' ? undefined : route.origin;
