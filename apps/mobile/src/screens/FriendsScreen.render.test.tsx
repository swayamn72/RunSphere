import React from 'react';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BlockedAccount, FriendRequest, Profile } from '@runsphere/contracts';
import type { MobileApiClient } from '../api-client';
import { ApiFailure } from '../api-client.js';

const ME = '00000000-0000-4000-8000-00000000000a';
const RAVI = '00000000-0000-4000-8000-00000000000b';
const ANA = '00000000-0000-4000-8000-00000000000c';

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
    tokens: {
      action: { primary: '#0A6' },
      background: { canvas: '#fff', surface: '#f7f7f7', surfaceInset: '#eee' },
      border: { subtle: '#ddd' },
      status: { success: '#0A6', error: '#C22' },
      text: { primary: '#111', secondary: '#555', onAccent: '#fff', inverse: '#fff' },
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

const { FriendsScreen } = await import('./FriendsScreen.js');
const { createMemoryGuidanceStore, setGuidanceStore } = await import('../loop-guidance.js');
const { INVITE_RECORDED_NOTICE } = await import('./friends-model.js');

const profile = (id: string, displayName: string): Profile => ({
  id,
  displayName,
  cosmetic: { avatarKey: 'loop-1' },
  activityVisibility: 'private'
});

const request = (id: string, from: Profile): FriendRequest => ({
  id,
  accountId: from.id,
  counterpartProfile: from,
  status: 'pending',
  createdAt: '2026-09-03T10:00:00.000Z'
});

const blocked = (from: Profile): BlockedAccount => ({
  profile: from,
  blockedAt: '2026-09-03T10:00:00.000Z'
});

const stubApi = (
  overrides: {
    friends?: Profile[];
    requests?: FriendRequest[];
    blocks?: BlockedAccount[];
    send?: () => Promise<{ status: 'recorded' }>;
    respond?: () => Promise<void>;
    report?: () => Promise<{ received: boolean; message: string }>;
  } = {}
) =>
  ({
    listFriends: vi.fn(async () => overrides.friends ?? []),
    listFriendRequests: vi.fn(async () => overrides.requests ?? []),
    listBlocks: vi.fn(async () => overrides.blocks ?? []),
    sendFriendRequest: vi.fn(overrides.send ?? (async () => ({ status: 'recorded' as const }))),
    respondFriendRequest: vi.fn(overrides.respond ?? (async () => undefined)),
    blockAccount: vi.fn(async () => ({ accountId: RAVI, status: 'blocked' as const })),
    unblockAccount: vi.fn(async () => ({ accountId: RAVI, status: 'unblocked' as const })),
    fileReport: vi.fn(
      overrides.report ??
        (async () => ({ received: true, message: 'Thanks — this is with our moderators.' }))
    )
  }) as unknown as MobileApiClient & Record<string, ReturnType<typeof vi.fn>>;

const render = async (api: MobileApiClient): Promise<ReactTestRenderer> => {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <FriendsScreen api={api} onBack={() => undefined} onSessionExpired={() => undefined} />
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

const byLabel = (renderer: ReactTestRenderer, predicate: (label: string) => boolean) =>
  renderer.root.findAll(
    (node) =>
      typeof node.type === 'string' &&
      predicate(String((node.props as Record<string, unknown>)['accessibilityLabel'] ?? ''))
  );

describe('Friends screen', () => {
  beforeEach(() => setGuidanceStore(createMemoryGuidanceStore()));

  it('offers accept and decline on an incoming request', async () => {
    const api = stubApi({ requests: [request('r1', profile(RAVI, 'Ravi'))] });
    const renderer = await render(api);

    expect(text(renderer)).toContain('Requests for you');
    expect(
      byLabel(renderer, (label) => label === 'Accept the friend request from Ravi')
    ).toHaveLength(1);
    expect(
      byLabel(renderer, (label) => label === 'Decline the friend request from Ravi')
    ).toHaveLength(1);
  });

  it('accepts a request through the server and reloads', async () => {
    const api = stubApi({ requests: [request('r1', profile(RAVI, 'Ravi'))] });
    const renderer = await render(api);
    const accept = byLabel(renderer, (label) => label.startsWith('Accept'))[0]!;

    await act(async () => (accept.props as { onPress: () => void }).onPress());

    expect(api.respondFriendRequest).toHaveBeenCalledWith('r1', true);
    // Two loads: the initial mount and the reload after answering.
    expect(api.listFriends).toHaveBeenCalledTimes(2);
  });

  it('confirms an invite without claiming it reached anyone', async () => {
    const api = stubApi();
    const renderer = await render(api);
    const field = renderer.root.findByType('TextInput' as React.ElementType);

    await act(async () =>
      (field.props as { onChangeText: (v: string) => void }).onChangeText('  Ravi@Example.com ')
    );
    const send = byLabel(renderer, (label) => label === 'Send friend request')[0]!;
    await act(async () => (send.props as { onPress: () => void }).onPress());

    expect(api.sendFriendRequest).toHaveBeenCalledWith({ email: 'ravi@example.com' });
    expect(text(renderer)).toContain(INVITE_RECORDED_NOTICE);
  });

  it('rejects an unusable address without spending a request', async () => {
    const api = stubApi();
    const renderer = await render(api);
    const field = renderer.root.findByType('TextInput' as React.ElementType);

    await act(async () =>
      (field.props as { onChangeText: (v: string) => void }).onChangeText('ravi')
    );
    const send = byLabel(renderer, (label) => label === 'Send friend request')[0]!;
    await act(async () => (send.props as { onPress: () => void }).onPress());

    expect(api.sendFriendRequest).not.toHaveBeenCalled();
    expect(text(renderer)).toContain('does not look like an email address');
  });

  it('reports a rate limit as retryable and keeps the typed address', async () => {
    const api = stubApi({
      send: async () => {
        throw new ApiFailure(429, 'Too many requests');
      }
    });
    const renderer = await render(api);
    const field = renderer.root.findByType('TextInput' as React.ElementType);

    await act(async () =>
      (field.props as { onChangeText: (v: string) => void }).onChangeText('ravi@example.com')
    );
    const send = byLabel(renderer, (label) => label === 'Send friend request')[0]!;
    await act(async () => (send.props as { onPress: () => void }).onPress());

    expect(text(renderer)).toContain('Try again in a minute');
    expect(renderer.root.findByType('TextInput' as React.ElementType).props.value).toBe(
      'ravi@example.com'
    );
  });

  it('warns what a block does before it is pressed', async () => {
    const api = stubApi({ friends: [profile(RAVI, 'Ravi')] });
    const renderer = await render(api);
    const block = byLabel(renderer, (label) => label === 'Block Ravi')[0]!;

    expect(String(block.props.accessibilityHint)).toContain('removes the friendship');
    await act(async () => (block.props as { onPress: () => void }).onPress());
    expect(api.blockAccount).toHaveBeenCalledWith({ accountId: RAVI });
  });

  it('keeps a block reversible by listing it', async () => {
    const api = stubApi({ blocks: [blocked(profile(ANA, 'Ana'))] });
    const renderer = await render(api);

    expect(text(renderer)).toContain('Blocked accounts');
    const unblock = byLabel(renderer, (label) => label === 'Unblock Ana')[0]!;
    await act(async () => (unblock.props as { onPress: () => void }).onPress());
    expect(api.unblockAccount).toHaveBeenCalledWith(ANA);
  });

  it('hides the blocked section when nobody is blocked', async () => {
    const renderer = await render(stubApi());
    expect(text(renderer)).not.toContain('Blocked accounts');
  });

  it('lets Coda explain why an empty friends list matters', async () => {
    const renderer = await render(stubApi());
    expect(byLabel(renderer, (label) => label.startsWith('Dismiss guidance'))).toHaveLength(1);
  });

  it('offers a retry when friends could not load, and changes nothing', async () => {
    const api = {
      listFriends: vi.fn(async () => {
        throw new Error('offline');
      }),
      listFriendRequests: vi.fn(async () => []),
      listBlocks: vi.fn(async () => [])
    } as unknown as MobileApiClient;
    const renderer = await render(api);

    expect(text(renderer)).toContain('Nothing was changed');
    expect(byLabel(renderer, (label) => label === 'Try again')).toHaveLength(1);
  });

  it('never renders an email address it was not given', async () => {
    const api = stubApi({
      friends: [profile(RAVI, 'Ravi')],
      requests: [request('r1', profile(ANA, 'Ana'))]
    });
    const renderer = await render(api);

    // The API never returns a counterpart address; the only place an address
    // appears is the field the account typed into.
    expect(text(renderer)).not.toContain('@example.com');
    expect(text(renderer)).not.toContain(ME);
  });
});

describe('reporting', () => {
  beforeEach(() => setGuidanceStore(createMemoryGuidanceStore()));

  it('offers reporting alongside blocking, since they answer different needs', async () => {
    const renderer = await render(stubApi({ friends: [profile(RAVI, 'Ravi')] }));

    expect(byLabel(renderer, (label) => label === 'Report Ravi')).toHaveLength(1);
    expect(byLabel(renderer, (label) => label === 'Block Ravi')).toHaveLength(1);
  });

  it('offers reporting for an account already blocked, which is the gap this closed', async () => {
    const renderer = await render(stubApi({ blocks: [blocked(profile(ANA, 'Ana'))] }));

    expect(byLabel(renderer, (label) => label === 'Report Ana')).toHaveLength(1);
  });

  it('asks for a published reason before it sends anything', async () => {
    const api = stubApi({ friends: [profile(RAVI, 'Ravi')] });
    const renderer = await render(api);
    const report = byLabel(renderer, (label) => label === 'Report Ravi')[0]!;
    await act(async () => (report.props as { onPress: () => void }).onPress());

    expect(api.fileReport).not.toHaveBeenCalled();
    const rendered = text(renderer);
    expect(rendered).toContain('Harassment or bullying');
    expect(rendered).toContain('Pretending to be someone else');
    // The screen says plainly that no outcome comes back.
    expect(rendered).toContain('You will not hear the outcome');
  });

  it('files the chosen reason and promises no follow-up', async () => {
    const api = stubApi({ friends: [profile(RAVI, 'Ravi')] });
    const renderer = await render(api);
    await act(async () =>
      (
        byLabel(renderer, (label) => label === 'Report Ravi')[0]!.props as { onPress: () => void }
      ).onPress()
    );
    await act(async () =>
      (
        byLabel(renderer, (label) => label === 'Report for Harassment or bullying')[0]!.props as {
          onPress: () => void;
        }
      ).onPress()
    );

    expect(api.fileReport).toHaveBeenCalledWith('account', RAVI, 'harassment');
    expect(text(renderer)).toContain('Report sent');
    // The reason list closes once the report is filed.
    expect(byLabel(renderer, (label) => label.startsWith('Report for'))).toHaveLength(0);
  });

  it('says nothing was sent when the report fails', async () => {
    const api = stubApi({
      friends: [profile(RAVI, 'Ravi')],
      report: async () => {
        throw new ApiFailure(400, 'That report cannot be filed');
      }
    });
    const renderer = await render(api);
    await act(async () =>
      (
        byLabel(renderer, (label) => label === 'Report Ravi')[0]!.props as { onPress: () => void }
      ).onPress()
    );
    await act(async () =>
      (
        byLabel(renderer, (label) => label === 'Report for Something else')[0]!.props as {
          onPress: () => void;
        }
      ).onPress()
    );

    expect(text(renderer)).toContain('Nothing was sent');
  });
});
