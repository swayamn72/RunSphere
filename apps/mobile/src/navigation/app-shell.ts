import type { ActivityRoute } from '../activity-flow';

export type AppShell = 'tab-scroll' | 'tab-map' | 'focused-scroll' | 'focused-flex';

/** Selects scroll/flex ownership from the explicit activity route. */
export const selectAppShell = ({
  activityRoute,
  hasRecording,
  hasSelectedQuest,
  liveInteractive,
  exploreInteractive
}: {
  activityRoute: ActivityRoute['screen'];
  hasRecording: boolean;
  hasSelectedQuest: boolean;
  liveInteractive: boolean;
  exploreInteractive: boolean;
}): AppShell => {
  if (hasRecording && liveInteractive) return 'focused-flex';
  if (activityRoute !== 'idle' || hasSelectedQuest || hasRecording) return 'focused-scroll';
  if (exploreInteractive) return 'tab-map';
  return 'tab-scroll';
};

export const isTabBarVisible = (shell: AppShell): boolean =>
  shell === 'tab-scroll' || shell === 'tab-map';
