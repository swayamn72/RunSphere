export type AppShell = 'tab-scroll' | 'focused-scroll' | 'focused-flex';

/** Current focused states contain forms/results and must scroll with large type. */
export const selectAppShell = ({
  activityStarted,
  hasRecording,
  liveInteractive
}: {
  activityStarted: boolean;
  hasRecording: boolean;
  liveInteractive: boolean;
}): AppShell => {
  if (hasRecording && liveInteractive) return 'focused-flex';
  if (activityStarted || hasRecording) return 'focused-scroll';
  return 'tab-scroll';
};

export const isTabBarVisible = (shell: AppShell): boolean => shell === 'tab-scroll';

/** Returns a focused activity flow to its tab-owned origin. */
export const exitActivityFlow = <T>(origin: T) => ({
  activityStarted: false,
  recording: undefined as undefined,
  activeTab: origin
});
