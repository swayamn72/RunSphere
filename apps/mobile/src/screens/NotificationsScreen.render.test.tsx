import React from 'react';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { InboxEntry, NotificationPreferences } from '@runsphere/contracts';
import type { MobileApiClient } from '../api-client';

vi.mock('react-native', async () => {
  const React = await import('react');
  const native =
    (name: string) =>
    ({ children, ...props }: Record<string, unknown>) =>
      React.createElement(name as React.ElementType, props, children as React.ReactNode);
  return {
    Pressable: native('Pressable'),
    StyleSheet: { create: <T,>(styles: T) => styles },
    Switch: native('Switch'),
    Text: native('Text'),
    TextInput: native('TextInput'),
    View: native('View')
  };
});
vi.mock('../components/styles', () => ({
  useAppStyles: () => new Proxy({}, { get: () => ({}) })
}));
vi.mock('../theme/theme', () => ({
  useAppTheme: () => ({
    colorScheme: 'light',
    reduceMotion: true,
    tokens: { text: { primary: '#111', secondary: '#555', inverse: '#fff' } }
  })
}));

const { NotificationsScreen } = await import('./NotificationsScreen.js');

const preferences = (
  overrides: Partial<NotificationPreferences> = {}
): NotificationPreferences => ({
  categories: {
    friends: true,
    challenges: true,
    clubs: true,
    competitions: true,
    account: true,
    marketing: false
  },
  maxPerDay: 50,
  channels: { push: true, email: false },
  marketingConsent: false,
  ...overrides
});

const entry = (overrides: Partial<InboxEntry> = {}): InboxEntry => ({
  id: 'n-1',
  kind: 'challenge_invite',
  title: 'New challenge invite',
  body: 'A friend invited you to a challenge.',
  createdAt: new Date().toISOString(),
  ...overrides
});

const stubApi = (
  overrides: {
    entries?: InboxEntry[];
    preferences?: NotificationPreferences;
    update?: (body: unknown) => Promise<NotificationPreferences>;
  } = {}
) => {
  const saved = overrides.preferences ?? preferences();
  return {
    getNotificationInbox: vi.fn(async () => overrides.entries ?? []),
    getNotificationPreferences: vi.fn(async () => saved),
    markNotificationsRead: vi.fn(async (_ids: readonly string[]) => undefined),
    updateNotificationPreferences: vi.fn(overrides.update ?? (async (_body: unknown) => saved))
  } as unknown as MobileApiClient & Record<string, ReturnType<typeof vi.fn>>;
};

const render = async (
  api: MobileApiClient,
  onOpenTarget: (target: 'play' | 'friends') => void = () => undefined
): Promise<ReactTestRenderer> => {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <NotificationsScreen
        api={api}
        onBack={() => undefined}
        onOpenTarget={onOpenTarget}
        onSessionExpired={() => undefined}
      />
    );
  });
  await act(async () => undefined);
  return renderer;
};

const text = (renderer: ReactTestRenderer): string =>
  renderer.root
    .findAllByType('Text' as React.ElementType)
    .flatMap((node) => node.children.filter((child): child is string => typeof child === 'string'))
    .join(' | ');

const byLabel = (renderer: ReactTestRenderer, label: string) =>
  renderer.root.findAll(
    (node) =>
      typeof node.type === 'string' &&
      (node.props as Record<string, unknown>)['accessibilityLabel'] === label
  );

describe('Notifications screen', () => {
  it('renders an inbox entry and marks it read because a person opened it', async () => {
    const api = stubApi({ entries: [entry()] });
    const renderer = await render(api);

    expect(text(renderer)).toContain('New challenge invite');
    expect(api.markNotificationsRead).toHaveBeenCalledWith(['n-1']);
  });

  it('marks an unread set only once, not on every render', async () => {
    const api = stubApi({ entries: [entry()] });
    await render(api);
    expect(api.markNotificationsRead).toHaveBeenCalledTimes(1);
  });

  it('offers Play for a challenge notice and friends for a friend request', async () => {
    const opened: string[] = [];
    const api = stubApi({
      entries: [
        entry({ id: 'a', deepLink: 'runsphere://challenges/1' }),
        entry({
          id: 'b',
          kind: 'friend_request',
          title: 'New friend request',
          body: 'Someone did.'
        })
      ]
    });
    const renderer = await render(api, (target) => opened.push(target));

    await act(async () =>
      (byLabel(renderer, 'Open Play')[0]!.props as { onPress: () => void }).onPress()
    );
    await act(async () =>
      (byLabel(renderer, 'Open friends')[0]!.props as { onPress: () => void }).onPress()
    );
    expect(opened).toEqual(['play', 'friends']);
  });

  it('offers no destination for a notice with nowhere to go', async () => {
    const renderer = await render(
      stubApi({ entries: [entry({ kind: 'system', title: 'Scheduled maintenance' })] })
    );
    expect(byLabel(renderer, 'Open Play')).toHaveLength(0);
    expect(byLabel(renderer, 'Open friends')).toHaveLength(0);
  });

  it('says the inbox still works when push cannot be delivered', async () => {
    const renderer = await render(stubApi());
    expect(text(renderer)).toContain('not being delivered yet');
    expect(text(renderer)).toContain('Everything still arrives here');
  });

  it('marks toggles that nothing produces yet rather than implying the feature exists', async () => {
    const renderer = await render(stubApi());
    expect(text(renderer)).toContain('Nothing sends this yet');
  });

  it('keeps save disabled until something actually changed', async () => {
    const renderer = await render(stubApi());
    const save = byLabel(renderer, 'Save notification settings')[0]!;
    expect(save.props.accessibilityState).toEqual({ disabled: true });

    await act(async () =>
      (
        byLabel(renderer, 'Challenges')[0]!.props as { onValueChange: (v: boolean) => void }
      ).onValueChange(false)
    );
    expect(byLabel(renderer, 'Save notification settings')[0]!.props.accessibilityState).toEqual({
      disabled: false
    });
  });

  it('sends only the preference that changed', async () => {
    const api = stubApi();
    const renderer = await render(api);

    await act(async () =>
      (
        byLabel(renderer, 'Challenges')[0]!.props as { onValueChange: (v: boolean) => void }
      ).onValueChange(false)
    );
    await act(async () =>
      (
        byLabel(renderer, 'Save notification settings')[0]!.props as { onPress: () => void }
      ).onPress()
    );

    expect(api.updateNotificationPreferences).toHaveBeenCalledTimes(1);
    const body = vi.mocked(api.updateNotificationPreferences).mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(Object.keys(body)).toEqual(['categories']);
    expect((body.categories as Record<string, boolean>).challenges).toBe(false);
  });

  it('clears quiet hours with an explicit null so the window can be switched off', async () => {
    const api = stubApi({
      preferences: preferences({
        quietHours: { start: '22:00', end: '07:00', timezone: 'Asia/Kolkata' }
      })
    });
    const renderer = await render(api);

    await act(async () =>
      (
        byLabel(renderer, 'Quiet hours')[0]!.props as { onValueChange: (v: boolean) => void }
      ).onValueChange(false)
    );
    await act(async () =>
      (
        byLabel(renderer, 'Save notification settings')[0]!.props as { onPress: () => void }
      ).onPress()
    );

    expect(api.updateNotificationPreferences).toHaveBeenCalledWith({ quietHours: null });
  });

  it('reports a save failure as changing nothing', async () => {
    const api = stubApi({
      update: async () => {
        throw new Error('offline');
      }
    });
    const renderer = await render(api);

    await act(async () =>
      (
        byLabel(renderer, 'Quiet hours')[0]!.props as { onValueChange: (v: boolean) => void }
      ).onValueChange(true)
    );
    await act(async () =>
      (
        byLabel(renderer, 'Save notification settings')[0]!.props as { onPress: () => void }
      ).onPress()
    );

    expect(text(renderer)).toContain('Nothing changed');
  });

  it('shows an empty inbox as nothing yet, not as a failure', async () => {
    const renderer = await render(stubApi());
    expect(text(renderer)).toContain('Nothing yet');
  });
});
