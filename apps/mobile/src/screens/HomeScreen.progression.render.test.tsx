import React from 'react';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { Profile, ProgressionSummary, WeeklyGoalResponse } from '@runsphere/contracts';
import type { MobileApiClient } from '../api-client';
import { ApiFailure } from '../api-client.js';

const SUCCESS = '#00AA88';
const ERROR = '#CC2222';
const WARNING = '#CC8800';

vi.mock('react-native', async () => {
  const React = await import('react');
  const native =
    (name: string) =>
    ({ children, ...props }: Record<string, unknown>) =>
      React.createElement(name as React.ElementType, props, children as React.ReactNode);
  return {
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
      status: { success: SUCCESS, error: ERROR, warning: WARNING },
      text: { primary: '#111', secondary: '#555' }
    }
  })
}));

const { HomeScreen } = await import('./HomeScreen.js');

/** No configured goal, so the only progressbar a case renders belongs to progression. */
const goalWithoutTargets: WeeklyGoalResponse = {
  weekStartsOn: '2026-08-31',
  activeMinutes: { actual: 40 },
  distanceMeters: { actual: 3200 }
};

const summary: ProgressionSummary = {
  totalXp: 1240,
  questsCompleted: 0,
  achievements: [],
  weeklyConsistency: {
    periodStart: '2026-08-31',
    activeDays: 3,
    cappedActiveMinutes: 182,
    goalActiveDays: 5,
    current: true
  },
  level: { level: 4, xpInLevel: 90, nextLevelAt: 1400 }
};

const profile: Profile = {
  id: '00000000-0000-4000-8000-000000000001',
  displayName: 'Maya',
  cosmetic: { avatarKey: 'loop-1', tier: 'Trailkeeper' },
  activityVisibility: 'private'
};

const stubApi = (overrides: {
  progression?: () => Promise<ProgressionSummary>;
  profile?: () => Promise<Profile>;
}): MobileApiClient =>
  ({
    getWeeklyGoal: () => Promise.resolve(goalWithoutTargets),
    listQuests: () => Promise.resolve([]),
    getProgressionSummary: overrides.progression ?? (() => Promise.resolve(summary)),
    getProfile: overrides.profile ?? (() => Promise.resolve(profile))
  }) as unknown as MobileApiClient;

const renderHome = async (api: MobileApiClient): Promise<ReactTestRenderer> => {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <HomeScreen
        api={api}
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

const renderedText = (renderer: ReactTestRenderer): string =>
  renderer.root
    .findAllByType('Text' as React.ElementType)
    .flatMap((node) => node.children.filter((child): child is string => typeof child === 'string'))
    .join(' | ');

/**
 * The `react-native` mock renders each primitive as a same-named host element,
 * so every match would otherwise be counted twice: once for the mock component
 * instance and once for the host element it creates.
 */
const hostsMatching = (
  renderer: ReactTestRenderer,
  predicate: (props: Record<string, unknown>) => boolean
) =>
  renderer.root.findAll(
    (node) => typeof node.type === 'string' && predicate(node.props as Record<string, unknown>),
    { deep: true }
  );

const flatStyles = (style: unknown): Record<string, unknown>[] =>
  (Array.isArray(style) ? style : [style]).filter(
    (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object'
  );

describe('Home progression cards render', () => {
  it('renders the served XP total, level band, tier, and count pips', async () => {
    const renderer = await renderHome(stubApi({}));
    const text = renderedText(renderer);
    expect(text).toContain('1,240 XP');
    expect(text).toContain('90 of 250 XP to level 5');
    expect(text).toContain('TRAILKEEPER');
    expect(text).toContain('3 of 7 active days');
    expect(text).toContain('182 counted active minutes');
    expect(text).toContain('This week');

    const bars = hostsMatching(renderer, (props) => props['accessibilityRole'] === 'progressbar');
    expect(bars).toHaveLength(1);
    expect(bars[0]?.props['accessibilityLabel']).toBe('Level 4, 36% toward level 5');
  });

  it('reads the pip row to TalkBack as one count and hides the individual pips', async () => {
    const renderer = await renderHome(stubApi({}));
    const rows = hostsMatching(
      renderer,
      (props) =>
        props['accessibilityLabel'] === '3 of 7 active days this week, 182 counted active minutes'
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.props['accessible']).toBe(true);
    const pips = hostsMatching(
      renderer,
      (props) => props['importantForAccessibility'] === 'no-hide-descendants'
    );
    expect(pips).toHaveLength(7);
    const fills = pips.map(
      (pip) =>
        flatStyles(pip.props['style']).find((entry) => 'backgroundColor' in entry)?.[
          'backgroundColor'
        ]
    );
    expect(fills.filter((fill) => fill === SUCCESS)).toHaveLength(3);
    expect(fills).not.toContain(ERROR);
    expect(fills).not.toContain(WARNING);
  });

  it('renders no level bar at the top published level and never a non-numeric width', async () => {
    const renderer = await renderHome(
      stubApi({
        progression: () =>
          Promise.resolve({ ...summary, totalXp: 3400, level: { level: 10, xpInLevel: 200 } })
      })
    );
    expect(renderedText(renderer)).toContain('200 XP at the top published level');
    expect(
      hostsMatching(renderer, (props) => props['accessibilityRole'] === 'progressbar')
    ).toHaveLength(0);
    const widths = renderer.root
      .findAllByType('View' as React.ElementType)
      .flatMap((node) => flatStyles(node.props['style']))
      .map((entry) => entry['width'])
      .filter((width): width is string => typeof width === 'string');
    expect(widths.some((width) => width.includes('NaN') || width.includes('undefined'))).toBe(
      false
    );
  });

  it('shows an explicit unavailable state for a 503 without inventing an XP total', async () => {
    const renderer = await renderHome(
      stubApi({ progression: () => Promise.reject(new ApiFailure(503, 'unavailable')) })
    );
    const text = renderedText(renderer);
    expect(text).toContain('Progression is not available on this server yet.');
    expect(text).not.toContain('XP');
    expect(text).not.toContain('active days');
  });

  it('keeps progression visible when the account has no profile to take a tier from', async () => {
    const renderer = await renderHome(
      stubApi({ profile: () => Promise.reject(new ApiFailure(404, 'no profile')) })
    );
    const text = renderedText(renderer);
    expect(text).toContain('1,240 XP');
    expect(text).not.toContain('TRAILKEEPER');
  });
});
