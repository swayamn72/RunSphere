import React from 'react';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { darkTokens } from '@runsphere/ui';
import type { Profile, ProgressionSummary, WeeklyGoalResponse } from '@runsphere/contracts';
import type { MobileApiClient } from '../api-client';
import { ApiFailure } from '../api-client.js';

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
vi.mock('../theme/theme', async () => (await import('../theme/theme-mock.js')).themeMock());

const { HomeScreen } = await import('./HomeScreen.js');

const goal: WeeklyGoalResponse = {
  weekStartsOn: '2026-08-31',
  activeMinutes: { goal: 150, actual: 40 },
  distanceMeters: { goal: 20_000, actual: 3_200 }
};

/** No configured targets: `actual` is still real, a goal-relative card is not. */
const goalWithoutTargets: WeeklyGoalResponse = {
  weekStartsOn: '2026-08-31',
  activeMinutes: { actual: 40 },
  distanceMeters: { actual: 3_200 }
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
  displayName: 'Maya Chen',
  cosmetic: { avatarKey: 'loop-1', tier: 'Trailkeeper' },
  activityVisibility: 'private'
};

const inboxEntry = (id: string, readAt?: string) => ({
  id,
  kind: 'challenge_finished' as const,
  title: 'Challenge scored',
  body: 'Your window closed.',
  createdAt: '2026-09-01T06:00:00Z',
  ...(readAt ? { readAt } : {})
});

const stubApi = (overrides: {
  goal?: () => Promise<WeeklyGoalResponse>;
  progression?: () => Promise<ProgressionSummary>;
  profile?: () => Promise<Profile>;
  inbox?: () => Promise<unknown>;
}): MobileApiClient =>
  ({
    getWeeklyGoal: overrides.goal ?? (() => Promise.resolve(goal)),
    listQuests: () => Promise.resolve([]),
    getProgressionSummary: overrides.progression ?? (() => Promise.resolve(summary)),
    getProfile: overrides.profile ?? (() => Promise.resolve(profile)),
    getNotificationInbox: overrides.inbox ?? (() => Promise.resolve([]))
  }) as unknown as MobileApiClient;

const renderHome = async (api: MobileApiClient): Promise<ReactTestRenderer> => {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <HomeScreen
        api={api}
        onStart={() => undefined}
        onChooseRoute={() => undefined}
        onOpenChallenges={() => undefined}
        onOpenQuests={() => undefined}
        onOpenMap={() => undefined}
        onOpenSocial={() => undefined}
        onOpenNotifications={() => undefined}
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

/** React Native flattens a style array left to right, so a later entry wins. */
const resolvedStyle = (style: unknown): Record<string, unknown> =>
  Object.assign({}, ...flatStyles(style)) as Record<string, unknown>;

describe('Home dashboard renders', () => {
  it('greets the reader by their served name and monogram', async () => {
    const renderer = await renderHome(stubApi({}));
    const text = renderedText(renderer);
    expect(text).toContain('Maya Chen!');
    expect(text).toContain('MC');
  });

  it('reports the served weekly figures and XP without inventing a tile', async () => {
    const text = renderedText(await renderHome(stubApi({})));
    expect(text).toContain('DISTANCE');
    expect(text).toContain('3.2');
    expect(text).toContain('ACTIVE MINUTES');
    expect(text).toContain('TOTAL XP');
    expect(text).toContain('1,240');
    expect(text).toContain('LEVEL');
    // Figures the product does not measure never reach the grid.
    for (const absent of ['CALORIES', 'kcal', 'Day Streak', 'ZONES CAPTURED'])
      expect(text).not.toContain(absent);
  });

  it('reads the active-days meter to TalkBack as one count and hides the pips', async () => {
    const renderer = await renderHome(stubApi({}));
    expect(renderedText(renderer)).toContain('Active days this week');

    const rows = hostsMatching(
      renderer,
      (props) => props['accessibilityLabel'] === '3 of 7 days active this week.'
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.props['accessible']).toBe(true);

    const pips = hostsMatching(
      renderer,
      (props) => props['importantForAccessibility'] === 'no-hide-descendants'
    );
    expect(pips).toHaveLength(7);
    const fills = pips.map((pip) => resolvedStyle(pip.props['style'])['backgroundColor']);
    expect(fills.filter((fill) => fill === darkTokens.action.primary)).toHaveLength(3);
    // An inactive day is neutral, never an error or a warning (ADR-0005).
    expect(fills).not.toContain(darkTokens.status.error);
    expect(fills).not.toContain(darkTokens.status.warning);
  });

  it('never names a weekday, which the server does not report', async () => {
    const renderer = await renderHome(stubApi({}));
    const text = renderedText(renderer);
    for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'])
      expect(text).not.toContain(day);
    // The meter's own label is a count, not a calendar.
    const meter = hostsMatching(renderer, (props) => props['accessible'] === true);
    for (const row of meter)
      expect(String(row.props['accessibilityLabel'])).toMatch(/^\d+ of 7 days active this week\.$/);
  });

  it('shows the weekly goal as the progress card, with a real bar', async () => {
    const renderer = await renderHome(stubApi({}));
    expect(renderedText(renderer)).toContain("This week's goal");
    const bars = hostsMatching(renderer, (props) => props['accessibilityRole'] === 'progressbar');
    expect(bars).toHaveLength(1);
    expect(bars[0]?.props['accessibilityValue']).toMatchObject({ min: 0, max: 100 });
  });

  it('offers no progress card and no goal-relative claim when no target is configured', async () => {
    const renderer = await renderHome(stubApi({ goal: () => Promise.resolve(goalWithoutTargets) }));
    const text = renderedText(renderer);
    expect(text).not.toContain("This week's goal");
    expect(text).toContain('Choose a distance or active-minute goal when you are ready.');
    expect(
      hostsMatching(renderer, (props) => props['accessibilityRole'] === 'progressbar')
    ).toHaveLength(0);
  });

  it('omits the XP tile and the meter for a 503 rather than inventing a total', async () => {
    const renderer = await renderHome(
      stubApi({ progression: () => Promise.reject(new ApiFailure(503, 'unavailable')) })
    );
    const text = renderedText(renderer);
    expect(text).not.toContain('TOTAL XP');
    expect(text).not.toContain('Active days this week');
    expect(text).not.toContain('1,240');
  });

  it('never renders a non-numeric bar width', async () => {
    const renderer = await renderHome(stubApi({}));
    const widths = renderer.root
      .findAllByType('View' as React.ElementType)
      .flatMap((node) => flatStyles(node.props['style']))
      .map((entry) => entry['width'])
      .filter((width): width is string => typeof width === 'string');
    expect(widths.some((width) => width.includes('NaN') || width.includes('undefined'))).toBe(
      false
    );
  });

  it('keeps the dashboard readable when the account has no profile to greet', async () => {
    const renderer = await renderHome(
      stubApi({ profile: () => Promise.reject(new ApiFailure(404, 'no profile')) })
    );
    const text = renderedText(renderer);
    expect(text).toContain('Runner!');
    expect(text).not.toContain('Maya Chen');
    expect(text).toContain('TOTAL XP');
  });

  it('offers the three quick actions', async () => {
    const renderer = await renderHome(stubApi({}));
    for (const label of ['Start Run', 'Explore Map', 'Friends'])
      expect(
        hostsMatching(renderer, (props) => props['accessibilityLabel'] === label)
      ).toHaveLength(1);
  });
});

describe('the notifications bell', () => {
  it('marks the bell and names the count once the inbox reports unread notices', async () => {
    const renderer = await renderHome(
      stubApi({
        inbox: () =>
          Promise.resolve([
            inboxEntry('a'),
            inboxEntry('b'),
            inboxEntry('c', '2026-09-02T06:00:00Z')
          ])
      })
    );
    // Two unread of three: the read one must not be counted.
    const [bell] = hostsMatching(
      renderer,
      (props) => props['accessibilityLabel'] === 'Notifications, 2 unread'
    );
    expect(bell).toBeDefined();
  });

  it('shows a plain bell with no marker when nothing is unread', async () => {
    const renderer = await renderHome(
      stubApi({ inbox: () => Promise.resolve([inboxEntry('a', '2026-09-02T06:00:00Z')]) })
    );
    expect(
      hostsMatching(renderer, (props) => props['accessibilityLabel'] === 'Notifications')
    ).toHaveLength(1);
    expect(
      hostsMatching(renderer, (props) =>
        String(props['accessibilityLabel'] ?? '').includes('unread')
      )
    ).toHaveLength(0);
  });

  it('never invents a marker when the inbox cannot be read', async () => {
    const renderer = await renderHome(
      stubApi({ inbox: () => Promise.reject(new ApiFailure(503, 'unavailable')) })
    );
    expect(
      hostsMatching(renderer, (props) => props['accessibilityLabel'] === 'Notifications')
    ).toHaveLength(1);
  });
});
