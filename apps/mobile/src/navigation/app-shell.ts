export type AppShell = 'tab-scroll' | 'tab-map' | 'focused-scroll' | 'focused-flex';

/** Selects a gesture-owning Explore map shell without hiding the tab bar. */
export const selectAppShell = ({
  activityStarted,
  hasRecording,
  liveInteractive,
  exploreInteractive
}: {
  activityStarted: boolean;
  hasRecording: boolean;
  liveInteractive: boolean;
  exploreInteractive: boolean;
}): AppShell => {
  if (hasRecording && liveInteractive) return 'focused-flex';
  if (activityStarted || hasRecording) return 'focused-scroll';
  if (exploreInteractive) return 'tab-map';
  return 'tab-scroll';
};

export const isTabBarVisible = (shell: AppShell): boolean =>
  shell === 'tab-scroll' || shell === 'tab-map';

/** Returns a focused activity flow to its tab-owned origin. */
export const exitActivityFlow = <T>(origin: T) => ({
  activityStarted: false,
  recording: undefined as undefined,
  activeTab: origin
});
