import React from 'react';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { FriendInvitePreview, PublicProfile } from '@runsphere/contracts';
import { ApiFailure } from '../api-client';

vi.mock('react-native', async () => {
  const React = await import('react');
  const native =
    (name: string) =>
    ({ children, ...props }: Record<string, unknown>) =>
      React.createElement(name as React.ElementType, props, children as React.ReactNode);
  return { Pressable: native('Pressable'), Text: native('Text'), View: native('View') };
});
vi.mock('../components/styles', () => ({
  useAppStyles: () => new Proxy({}, { get: () => ({}) })
}));
vi.mock('../components/primitives', async () => {
  const React = await import('react');
  return {
    PrimaryButton: ({ label, onPress }: { label: string; onPress: () => void }) =>
      React.createElement('Pressable', { accessibilityLabel: label, onPress })
  };
});

const { InviteAcceptSheet, INVITE_EXPIRED } = await import('./InviteAcceptSheet.js');

const ravi: PublicProfile = {
  id: '00000000-0000-4000-8000-000000000001',
  username: 'ravi_runs',
  displayName: 'Ravi',
  cosmetic: { avatarKey: 'default' },
  relationship: 'none',
  canSendRequest: false
};
const preview: FriendInvitePreview = { inviter: ravi, expiresAt: '2026-11-28T00:00:00.000Z' };

const texts = (renderer: ReactTestRenderer) =>
  renderer.root
    .findAll((node) => (node.type as unknown) === 'Text')
    .map((node) => [node.props.children].flat().join(''));

const render = async (api: React.ComponentProps<typeof InviteAcceptSheet>['api']) => {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<InviteAcceptSheet api={api} token={'x'.repeat(32)} onClose={() => {}} />);
  });
  return renderer;
};

describe('friend invite sheet', () => {
  it('shows who invited you and makes you friends on accept', async () => {
    const acceptFriendInvite = vi.fn(async () => ({ status: 'friends' as const, friend: ravi }));
    const renderer = await render({
      previewFriendInvite: async () => preview,
      acceptFriendInvite
    });
    expect(texts(renderer)).toContain('Ravi invited you');
    expect(texts(renderer)).toContain('@ravi_runs');

    const accept = renderer.root.find(
      (node) =>
        (node.props as { accessibilityLabel?: string }).accessibilityLabel === 'Become friends'
    );
    await act(async () => (accept.props as { onPress: () => void }).onPress());
    expect(acceptFriendInvite).toHaveBeenCalledWith('x'.repeat(32));
    expect(texts(renderer)).toContain('You and Ravi are friends');
  });

  it('says plainly when an invite has expired', async () => {
    const renderer = await render({
      previewFriendInvite: async () => {
        throw new ApiFailure(404, 'gone');
      },
      acceptFriendInvite: vi.fn()
    });
    expect(texts(renderer)).toContain(INVITE_EXPIRED);
  });
});
