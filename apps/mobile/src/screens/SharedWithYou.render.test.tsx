import React from 'react';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { SafetyShareReceived } from '@runsphere/contracts';

vi.mock('react-native', async () => {
  const React = await import('react');
  const native =
    (name: string) =>
    ({ children, ...props }: Record<string, unknown>) =>
      React.createElement(name as React.ElementType, props, children as React.ReactNode);
  return {
    Linking: { openURL: async () => true },
    Pressable: native('Pressable'),
    Text: native('Text'),
    View: native('View')
  };
});
vi.mock('../components/styles', () => ({
  useAppStyles: () => new Proxy({}, { get: () => ({}) })
}));

const { SharedWithYou } = await import('./SharedWithYou.js');

const share: SafetyShareReceived = {
  id: '00000000-0000-4000-8000-000000000001',
  sharerDisplayName: 'Maya',
  sharerUsername: 'maya_runs',
  startedAt: '2026-11-21T05:00:00.000Z',
  expiresAt: '2026-11-21T06:00:00.000Z'
};

const texts = (renderer: ReactTestRenderer) =>
  renderer.root
    .findAll((node) => (node.type as unknown) === 'Text')
    .map((node) => [node.props.children].flat().join(''));
const press = async (renderer: ReactTestRenderer, label: string) => {
  const node = renderer.root.find(
    (candidate) => (candidate.props as { accessibilityLabel?: string }).accessibilityLabel === label
  );
  await act(async () => (node.props as { onPress: () => void }).onPress());
};

describe('shared with you (M3.6)', () => {
  it('shows nothing when nobody is sharing', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <SharedWithYou
          api={{ listReceivedSafetyShares: async () => [], readDelayedSafetyShare: vi.fn() }}
        />
      );
    });
    expect(renderer.toJSON()).toBeNull();
  });

  it('checks in on a share and opens its approximate area', async () => {
    const openUrl = vi.fn(async () => true);
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <SharedWithYou
          openUrl={openUrl}
          api={{
            listReceivedSafetyShares: async () => [share],
            readDelayedSafetyShare: async () => ({
              status: 'active' as const,
              delayMinutes: 15 as const,
              tileSizeMeters: 500 as const,
              updates: [{ tileX: 14_620, tileY: 4_211, observedAt: '2026-11-21T05:40:00.000Z' }]
            })
          }}
        />
      );
    });
    expect(texts(renderer)).toContain('Maya is sharing with you');

    await press(renderer, 'Check in on Maya');
    expect(texts(renderer).join(' ')).toMatch(/within about 500 m\. Shown 15 minutes late\./);

    await press(renderer, 'Open the approximate area for Maya in maps');
    expect(openUrl).toHaveBeenCalledWith(expect.stringMatching(/^geo:.*\(Approximate area\)$/));
  });
});
