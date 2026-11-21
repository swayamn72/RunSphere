import React from 'react';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { PrivacySettings } from '@runsphere/contracts';

vi.mock('react-native', async () => {
  const React = await import('react');
  const native =
    (name: string) =>
    ({ children, ...props }: Record<string, unknown>) =>
      React.createElement(name as React.ElementType, props, children as React.ReactNode);
  return {
    Pressable: native('Pressable'),
    Switch: native('Switch'),
    Text: native('Text'),
    TextInput: native('TextInput'),
    View: native('View')
  };
});
vi.mock('../components/styles', () => ({
  useAppStyles: () => new Proxy({}, { get: () => ({}) })
}));
vi.mock('../components/primitives', async () => {
  const React = await import('react');
  return {
    BackHeader: () => null,
    SettingsGroup: ({ children }: { children: React.ReactNode }) =>
      React.createElement('View', null, children)
  };
});
vi.mock('../theme/theme', () => ({
  useAppTheme: () => ({
    tokens: { text: { secondary: '#555' }, border: { subtle: '#333' }, status: { success: '#0f0' } }
  })
}));

const { PrivacySettingsScreen } = await import('./PrivacySettingsScreen.js');

const loaded: PrivacySettings = {
  profileVisibility: 'everyone',
  searchable: true,
  friendRequestsFrom: 'everyone',
  runsVisibility: 'friends',
  showRouteMaps: true,
  showStartTimes: false,
  nameOnGround: true,
  drawGround: true,
  friendBoard: true,
  ghostRaces: true,
  reviewed: false
};

const stubApi = (save: (update: Partial<PrivacySettings>) => Promise<PrivacySettings>) => ({
  getPrivacySettings: vi.fn(async () => loaded),
  savePrivacySettings: vi.fn(save),
  getIdentity: vi.fn(async () => ({ username: 'maya_runs', hasDateOfBirth: true })),
  saveIdentity: vi.fn(async () => ({ username: 'maya_runs', hasDateOfBirth: true }))
});

const render = async (api: ReturnType<typeof stubApi>) => {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<PrivacySettingsScreen api={api} onBack={() => undefined} />);
  });
  return renderer;
};

const switchFor = (renderer: ReactTestRenderer, label: string) =>
  renderer.root.find(
    (node) =>
      (node.type as unknown) === 'Switch' &&
      (node.props as { accessibilityLabel?: string }).accessibilityLabel === label
  );

describe('Privacy & visibility screen (SI.5)', () => {
  it('loads the saved settings and saves one change at a time', async () => {
    const api = stubApi(async (update) => ({ ...loaded, ...update }));
    const renderer = await render(api);
    const ghost = switchFor(renderer, 'Allow Ghost Races on my loops');
    expect(ghost.props.value).toBe(true);

    await act(async () =>
      (ghost.props as { onValueChange: (v: boolean) => void }).onValueChange(false)
    );
    expect(api.savePrivacySettings).toHaveBeenCalledWith({ ghostRaces: false });
    expect(switchFor(renderer, 'Allow Ghost Races on my loops').props.value).toBe(false);
  });

  it('puts the old value back when a save fails', async () => {
    const api = stubApi(async () => {
      throw new Error('offline');
    });
    const renderer = await render(api);
    await act(async () =>
      (
        switchFor(renderer, 'Show me in search').props as {
          onValueChange: (v: boolean) => void;
        }
      ).onValueChange(false)
    );
    expect(switchFor(renderer, 'Show me in search').props.value).toBe(true);
  });
});
