import { describe, expect, it } from 'vitest';
import { isTabBarVisible, selectAppShell } from './app-shell.js';

const standard = {
  activityRoute: 'idle' as const,
  hasRecording: false,
  hasSelectedQuest: false,
  liveInteractive: false
};

describe('app shell selection', () => {
  it('keeps standard tab screens scroll-owned and preparation/detail/results scrollable', () => {
    expect(selectAppShell({ ...standard, mapInteractive: false })).toBe('tab-scroll');
    expect(selectAppShell({ ...standard, activityRoute: 'prepare', mapInteractive: false })).toBe(
      'focused-scroll'
    );
    expect(selectAppShell({ ...standard, hasRecording: true, mapInteractive: false })).toBe(
      'focused-scroll'
    );
  });

  it('gives the zone map gestures a flex shell while retaining the tab bar', () => {
    expect(selectAppShell({ ...standard, mapInteractive: true })).toBe('tab-map');
    expect(isTabBarVisible('tab-map')).toBe(true);
    expect(isTabBarVisible('tab-scroll')).toBe(true);
  });

  it('gives every surface opened over a tab a focused shell, so choosing is not a tab', () => {
    // Each owns a back header; the tab bar underneath it would offer two ways
    // out of the same screen.
    for (const focus of ['route-preview', 'challenges', 'quests'] as const)
      expect(selectAppShell({ ...standard, focus, mapInteractive: true })).toBe('focused-scroll');
    expect(isTabBarVisible('focused-scroll')).toBe(false);
  });

  it('keeps the tab bar for a tab that has nothing open over it', () => {
    expect(selectAppShell({ ...standard, focus: 'none', mapInteractive: false })).toBe(
      'tab-scroll'
    );
  });

  it('reserves focused flex ownership for interactive Live recording', () => {
    expect(
      selectAppShell({
        ...standard,
        hasRecording: true,
        liveInteractive: true,
        mapInteractive: false
      })
    ).toBe('focused-flex');
    expect(isTabBarVisible('focused-scroll')).toBe(false);
    expect(isTabBarVisible('focused-flex')).toBe(false);
  });
});
