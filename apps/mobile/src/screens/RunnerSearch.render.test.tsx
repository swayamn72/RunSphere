import React from 'react';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PublicProfile } from '@runsphere/contracts';

const share = vi.fn(async (_content: { message: string }) => ({ action: 'sharedAction' }));
vi.mock('react-native', async () => {
  const React = await import('react');
  const native =
    (name: string) =>
    ({ children, ...props }: Record<string, unknown>) =>
      React.createElement(name as React.ElementType, props, children as React.ReactNode);
  return {
    Pressable: native('Pressable'),
    Share: { share: (content: { message: string }) => share(content) },
    Text: native('Text'),
    TextInput: native('TextInput'),
    View: native('View')
  };
});
vi.mock('../components/styles', () => ({
  useAppStyles: () => new Proxy({}, { get: () => ({}) })
}));
vi.mock('../theme/theme', () => ({
  useAppTheme: () => ({ tokens: { text: { secondary: '#555' } } })
}));

const { RunnerSearch } = await import('./RunnerSearch.js');

const ravi: PublicProfile = {
  id: '00000000-0000-4000-8000-000000000001',
  username: 'ravi_runs',
  displayName: 'Ravi',
  cosmetic: { avatarKey: 'default' },
  homeArea: 'Kurla West',
  relationship: 'none',
  canSendRequest: true
};

const stubApi = () => ({
  searchRunners: vi.fn(async (_q: string) => [ravi]),
  sendFriendRequest: vi.fn(async () => ({ status: 'recorded' as const })),
  createFriendInvite: vi.fn(async () => ({
    token: 'x'.repeat(32),
    link: `runsphere://invite/${'x'.repeat(32)}`,
    expiresAt: '2026-11-28T00:00:00.000Z'
  }))
});

const labelled = (renderer: ReactTestRenderer, label: string) =>
  renderer.root.find(
    (node) => (node.props as { accessibilityLabel?: string }).accessibilityLabel === label
  );
const texts = (renderer: ReactTestRenderer) =>
  renderer.root
    .findAll((node) => (node.type as unknown) === 'Text')
    .map((node) => [node.props.children].flat().join(''));

afterEach(() => vi.useRealTimers());

const typeAndWait = async (renderer: ReactTestRenderer, value: string) => {
  const field = labelled(renderer, 'Search runners by username');
  await act(async () => (field.props as { onChangeText: (v: string) => void }).onChangeText(value));
  await act(async () => {
    vi.advanceTimersByTime(350);
    await Promise.resolve();
  });
};

describe('runner search', () => {
  it('searches by @username after typing stops and offers Add', async () => {
    vi.useFakeTimers();
    const api = stubApi();
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<RunnerSearch api={api} />);
    });
    await typeAndWait(renderer, '@Ravi');

    expect(api.searchRunners).toHaveBeenCalledWith('ravi');
    expect(texts(renderer)).toContain('@ravi_runs · Kurla West');

    const add = labelled(renderer, 'Add @ravi_runs as a friend');
    await act(async () => (add.props as { onPress: () => void }).onPress());
    expect(api.sendFriendRequest).toHaveBeenCalledWith({ username: 'ravi_runs' });
    expect(texts(renderer)).toContain('Requested');
  });

  it('does not search for a single letter', async () => {
    vi.useFakeTimers();
    const api = stubApi();
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<RunnerSearch api={api} />);
    });
    await typeAndWait(renderer, 'r');
    expect(api.searchRunners).not.toHaveBeenCalled();
  });

  it('shares an invite link through the share sheet', async () => {
    const api = stubApi();
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<RunnerSearch api={api} />);
    });
    const invite = labelled(renderer, 'Share an invite link');
    await act(async () => (invite.props as { onPress: () => void }).onPress());
    expect(share).toHaveBeenCalledWith({
      message: expect.stringContaining('runsphere://invite/')
    });
  });
});
