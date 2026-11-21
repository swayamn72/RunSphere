import React from 'react';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { PublicProfile } from '@runsphere/contracts';
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

const { RunnerProfileSheet, initialsOf } = await import('./RunnerProfileSheet.js');

const ravi: PublicProfile = {
  id: '00000000-0000-4000-8000-000000000001',
  username: 'ravi_runs',
  displayName: 'Ravi Shah',
  cosmetic: { avatarKey: 'default' },
  homeArea: 'Kurla West',
  relationship: 'none',
  canSendRequest: true
};

const texts = (renderer: ReactTestRenderer) =>
  renderer.root
    .findAll((node) => (node.type as unknown) === 'Text')
    .map((node) => [node.props.children].flat().join(''));

const open = async (getRunnerProfile: (u: string) => Promise<PublicProfile>) => {
  const api = {
    getRunnerProfile: vi.fn(getRunnerProfile),
    sendFriendRequest: vi.fn(async () => ({ status: 'recorded' as const })),
    fileReport: vi.fn(async () => ({ received: true, message: 'Thanks.' }))
  };
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<RunnerProfileSheet api={api} username="ravi_runs" onClose={() => {}} />);
  });
  return { api, renderer };
};

describe('runner profile sheet (SI.6)', () => {
  it('shows the runner and lets the reader add them', async () => {
    const { api, renderer } = await open(async () => ravi);
    expect(texts(renderer)).toEqual(
      expect.arrayContaining(['RS', 'Ravi Shah', '@ravi_runs · Kurla West'])
    );
    const add = renderer.root.find(
      (node) =>
        (node.props as { accessibilityLabel?: string }).accessibilityLabel ===
        'Add @ravi_runs as a friend'
    );
    await act(async () => (add.props as { onPress: () => void }).onPress());
    expect(api.sendFriendRequest).toHaveBeenCalledWith({ username: 'ravi_runs' });
    expect(texts(renderer)).toContain('Requested');
  });

  it('says a hidden profile is private, without confirming it exists', async () => {
    const { renderer } = await open(async () => {
      throw new ApiFailure(404, 'Runner not found');
    });
    expect(texts(renderer)).toContain("This runner's profile is private.");
  });

  it('reports a runner from their profile, but not yourself (M8 C.9)', async () => {
    const { api, renderer } = await open(async () => ravi);
    const report = renderer.root.find(
      (node) =>
        (node.props as { accessibilityLabel?: string }).accessibilityLabel === 'Report @ravi_runs'
    );
    await act(async () => (report.props as { onPress: () => void }).onPress());
    const reason = renderer.root.findAll((node) =>
      String((node.props as { accessibilityLabel?: string }).accessibilityLabel ?? '').startsWith(
        'Report for '
      )
    )[0]!;
    await act(async () => (reason.props as { onPress: () => void }).onPress());
    expect(api.fileReport).toHaveBeenCalledWith('account', ravi.id, expect.any(String));

    const self = await open(async () => ({ ...ravi, relationship: 'self' }));
    expect(
      self.renderer.root.findAll(
        (node) =>
          (node.props as { accessibilityLabel?: string }).accessibilityLabel === 'Report @ravi_runs'
      )
    ).toHaveLength(0);
  });

  it('makes initials from up to two words', () => {
    expect(initialsOf('maya chen rao')).toBe('MC');
    expect(initialsOf('  ')).toBe('?');
  });
});
