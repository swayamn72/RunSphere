import { describe, expect, it } from 'vitest';
import { exitActivityFlow, isTabBarVisible, selectAppShell } from './app-shell.js';

describe('app shell selection', () => {
  it('keeps tab screens scroll-owned and preparation/detail/results scrollable', () => {
    expect(
      selectAppShell({ activityStarted: false, hasRecording: false, liveInteractive: false })
    ).toBe('tab-scroll');
    expect(
      selectAppShell({ activityStarted: true, hasRecording: false, liveInteractive: false })
    ).toBe('focused-scroll');
    expect(
      selectAppShell({ activityStarted: false, hasRecording: true, liveInteractive: false })
    ).toBe('focused-scroll');
  });

  it('reserves flex ownership for future interactive Live surfaces', () => {
    expect(
      selectAppShell({ activityStarted: false, hasRecording: true, liveInteractive: true })
    ).toBe('focused-flex');
    expect(isTabBarVisible('tab-scroll')).toBe(true);
    expect(isTabBarVisible('focused-scroll')).toBe(false);
    expect(isTabBarVisible('focused-flex')).toBe(false);
  });

  it('clears activity state when leaving a focused flow', () => {
    expect(exitActivityFlow('Explore')).toEqual({
      activityStarted: false,
      recording: undefined,
      activeTab: 'Explore'
    });
  });
});
