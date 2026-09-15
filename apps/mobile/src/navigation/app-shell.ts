import type { ActivityRoute, FocusedSurface } from '../activity-flow';

export type AppShell = 'tab-scroll' | 'tab-map' | 'focused-scroll' | 'focused-flex';

/** Selects scroll/flex ownership from the explicit activity route. */
export const selectAppShell = ({
  activityRoute,
  hasRecording,
  hasSelectedQuest,
  focus = 'none',
  liveInteractive,
  mapInteractive
}: {
  activityRoute: ActivityRoute['screen'];
  hasRecording: boolean;
  hasSelectedQuest: boolean;
  /**
   * A surface open over a tab. Each owns a back header and, in the case of the
   * route preview, a decision — so the tab bar underneath would offer a second
   * way out of the same choice.
   */
  focus?: FocusedSurface;
  liveInteractive: boolean;
  /** The zone map owns its own gestures, so it gets flex while keeping the bar. */
  mapInteractive: boolean;
}): AppShell => {
  if (hasRecording && liveInteractive) return 'focused-flex';
  if (activityRoute !== 'idle' || hasSelectedQuest || focus !== 'none' || hasRecording)
    return 'focused-scroll';
  if (mapInteractive) return 'tab-map';
  return 'tab-scroll';
};

export const isTabBarVisible = (shell: AppShell): boolean =>
  shell === 'tab-scroll' || shell === 'tab-map';
