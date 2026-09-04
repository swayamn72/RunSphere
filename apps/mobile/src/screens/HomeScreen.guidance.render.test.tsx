import React from 'react';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Profile, ProgressionSummary, WeeklyGoalResponse } from '@runsphere/contracts';
import type { MobileApiClient } from '../api-client';

vi.mock('react-native', async () => {
  const React = await import('react');
  const native =
    (name: string) =>
    ({ children, ...props }: Record<string, unknown>) =>
      React.createElement(name as React.ElementType, props, children as React.ReactNode);
  return {
    Image: native('Image'),
    Pressable: native('Pressable'),
    StyleSheet: { create: <T,>(styles: T) => styles },
    Text: native('Text'),
    View: native('View')
  };
});
vi.mock('../components/Mascot', () => ({ LoopMascot: () => null }));
vi.mock('../components/primitives', () => ({
  MovementChoice: () => null,
  PrimaryButton: () => null
}));
vi.mock('../theme/theme', () => ({
  useAppTheme: () => ({
    colorScheme: 'light',
    reduceMotion: true,
    tokens: {
      action: { primary: '#0A6', selected: '#0A6' },
      background: { canvas: '#fff', surface: '#f7f7f7', surfaceInset: '#eee' },
      border: { subtle: '#ddd' },
      status: { success: '#0A6', error: '#C22', warning: '#C80' },
      text: { primary: '#111', secondary: '#555', onAccent: '#fff' },
      mascot: {
        body: '#D9EAE0',
        outline: '#386755',
        orbit: '#5D8500',
        pointer: '#087B69',
        eye: '#10251F',
        beacon: '#8FBD18'
      }
    }
  })
}));

const { HomeScreen } = await import('./HomeScreen.js');
const { createMemoryGuidanceStore, emptyGuidanceMemory, recordWeekSeen, setGuidanceStore } =
  await import('../loop-guidance.js');

const goal: WeeklyGoalResponse = {
  weekStartsOn: '2026-09-07',
  activeMinutes: { actual: 0, goal: 150 },
  distanceMeters: { actual: 0, goal: 10_000 }
};

const summary: ProgressionSummary = {
  totalXp: 1240,
  questsCompleted: 0,
  achievements: [],
  weeklyConsistency: {
    periodStart: '2026-09-07',
    activeDays: 0,
    cappedActiveMinutes: 0,
    goalActiveDays: 5,
    current: true
  },
  level: { level: 4, xpInLevel: 90, nextLevelAt: 1400 }
};

const profile: Profile = {
  id: '00000000-0000-4000-8000-000000000001',
  displayName: 'Maya',
  cosmetic: { avatarKey: 'loop-1' },
  activityVisibility: 'private'
};

const stubApi = (): MobileApiClient =>
  ({
    getWeeklyGoal: () => Promise.resolve(goal),
    listQuests: () => Promise.resolve([]),
    getProgressionSummary: () => Promise.resolve(summary),
    getProfile: () => Promise.resolve(profile)
  }) as unknown as MobileApiClient;

const renderHome = async (): Promise<ReactTestRenderer> => {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <HomeScreen
        api={stubApi()}
        movement="walk"
        onMovementChange={() => undefined}
        onStart={() => undefined}
        onOpenQuests={() => undefined}
        onOpenProfile={() => undefined}
        onSessionExpired={() => undefined}
      />
    );
  });
  await act(async () => undefined);
  return renderer;
};

const guidanceControls = (renderer: ReactTestRenderer) =>
  renderer.root.findAll(
    (node) =>
      typeof node.type === 'string' &&
      String((node.props as Record<string, unknown>)['accessibilityLabel'] ?? '').startsWith(
        'Dismiss guidance'
      )
  );

describe('Home weekly reset guidance', () => {
  beforeEach(() => setGuidanceStore(createMemoryGuidanceStore()));

  it('says nothing on a first run, when no earlier week was ever rendered', async () => {
    expect(guidanceControls(await renderHome())).toHaveLength(0);
  });

  it('lets Rho mark a week boundary the reader has crossed', async () => {
    setGuidanceStore(createMemoryGuidanceStore(recordWeekSeen(emptyGuidanceMemory, '2026-08-31')));
    const renderer = await renderHome();

    const dismiss = guidanceControls(renderer);
    expect(dismiss).toHaveLength(1);
    expect(dismiss[0]!.props.accessibilityLabel).toBe('Dismiss guidance from Rho');

    await act(async () => (dismiss[0]!.props as { onPress: () => void }).onPress());
    expect(guidanceControls(renderer)).toHaveLength(0);
  });

  it('says nothing again once the week it recorded is the week on screen', async () => {
    setGuidanceStore(createMemoryGuidanceStore(recordWeekSeen(emptyGuidanceMemory, '2026-09-07')));
    expect(guidanceControls(await renderHome())).toHaveLength(0);
  });
});
