import { describe, expect, it } from 'vitest';
import { exitActivityFlow, isTabBarVisible, selectAppShell } from './app-shell.js';

const standard = { activityStarted: false, hasRecording: false, liveInteractive: false };

describe('app shell selection', () => {
  it('keeps standard tab screens scroll-owned and preparation/detail/results scrollable', () => {
    expect(selectAppShell({ ...standard, exploreInteractive: false })).toBe('tab-scroll');
    expect(selectAppShell({ ...standard, activityStarted: true, exploreInteractive: false })).toBe(
      'focused-scroll'
    );
    expect(selectAppShell({ ...standard, hasRecording: true, exploreInteractive: false })).toBe(
      'focused-scroll'
    );
  });

  it('gives Explore map gestures a flex shell while retaining the tab bar', () => {
    expect(selectAppShell({ ...standard, exploreInteractive: true })).toBe('tab-map');
    expect(isTabBarVisible('tab-map')).toBe(true);
    expect(isTabBarVisible('tab-scroll')).toBe(true);
  });

  it('reserves focused flex ownership for interactive Live recording', () => {
    expect(
      selectAppShell({
        ...standard,
        hasRecording: true,
        liveInteractive: true,
        exploreInteractive: false
      })
    ).toBe('focused-flex');
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
