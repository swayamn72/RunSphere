import type { ActivityRoute, FocusedSurface } from '../activity-flow';

export type AppShell = 'tab-scroll' | 'tab-map' | 'focused-scroll' | 'focused-flex' | 'focused-map';

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
  // A quest opens on its own map, edge to edge, with its stops and nothing
  // else: it owns its gestures, and its back button is the way out.
  if (hasSelectedQuest && !hasRecording && focus !== 'route-preview' && activityRoute === 'idle')
    return 'focused-map';
  if (
    hasRecording ||
    hasSelectedQuest ||
    focus !== 'none' ||
    activityRoute === 'live' ||
    activityRoute === 'result'
  )
    return 'focused-scroll';
  if (mapInteractive) return 'tab-map';
  return 'tab-scroll';
};

export const isTabBarVisible = (shell: AppShell): boolean =>
  shell === 'tab-scroll' || shell === 'tab-map';
