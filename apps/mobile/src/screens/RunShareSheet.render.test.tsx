import React from 'react';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import { TurfrMark } from '../components/TurfrMark.js';

vi.mock('react-native', async () => {
  const React = await import('react');
  const native =
    (name: string) =>
    ({ children, ...props }: Record<string, unknown>) =>
      React.createElement(name as React.ElementType, props, children as React.ReactNode);
  return {
    Modal: native('Modal'),
    Pressable: native('Pressable'),
    StyleSheet: { create: <T,>(styles: T) => styles, absoluteFill: {} },
    Text: native('Text'),
    View: native('View')
  };
});
vi.mock('../theme/theme', async () => (await import('../theme/theme-mock.js')).themeMock());

const { RunShareSheet, SHARE_UNAVAILABLE, SHARE_FAILED } = await import('./RunShareSheet.js');
const { runShareCard } = await import('./run-share-model.js');

const card = runShareCard({
  metrics: {
    distanceMeters: 5_020,
    elapsedSeconds: 1_575,
    movingPaceSecondsPerKm: 313.7,
    elevation: { gainMeters: 42 }
  },
  startedAt: '2026-11-24T00:45:00.000Z',
  lines: [
    [
      [0, 0],
      [0.002, 0],
      [0.002, 0.002]
    ]
  ]
})!;

const textOf = (renderer: ReactTestRenderer) =>
  renderer.root
    .findAllByType('Text' as React.ElementType)
    .map((node) => (node.props.children as unknown[]).toString())
    .join(' | ');

const pressShare = async (renderer: ReactTestRenderer) => {
  const button = renderer.root
    .findAllByType('Pressable' as React.ElementType)
    .find((node) => node.props.accessibilityLabel === 'Share your run');
  await act(async () => {
    await button!.props.onPress();
  });
};

describe('the run share sheet', () => {
  beforeEach(() => vi.clearAllMocks());

  it('previews the card with the run’s numbers and no map', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<RunShareSheet card={card} visible onClose={() => {}} />);
    });
    const text = textOf(renderer);
    for (const value of ['TURFR', 'Morning run', '5.02 km', '26:15', '5:14 /km', '42 m'])
      expect(text).toContain(value);
    expect(renderer.root.findAllByType('Map' as React.ElementType)).toHaveLength(0);
    const capturedCard = renderer.root
      .findAllByType('View' as React.ElementType)
      .find(
        (node) => node.props.collapsable === false && node.props.accessibilityLabel === card.summary
      );
    expect(capturedCard?.findAllByType(TurfrMark)).toHaveLength(1);
  });

  it('captures the card as a 1080 × 1350 image and opens the share sheet with it', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<RunShareSheet card={card} visible onClose={() => {}} />);
    });
    await pressShare(renderer);
    expect(captureRef).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ format: 'png', width: 1080, height: 1350 })
    );
    expect(Sharing.shareAsync).toHaveBeenCalledWith(
      'file:///tmp/run.png',
      expect.objectContaining({ mimeType: 'image/png' })
    );
  });

  it('says so when the phone cannot share, and when the image fails', async () => {
    vi.mocked(Sharing.isAvailableAsync).mockResolvedValueOnce(false);
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<RunShareSheet card={card} visible onClose={() => {}} />);
    });
    await pressShare(renderer);
    expect(textOf(renderer)).toContain(SHARE_UNAVAILABLE);
    expect(Sharing.shareAsync).not.toHaveBeenCalled();

    vi.mocked(captureRef).mockRejectedValueOnce(new Error('boom'));
    await pressShare(renderer);
    expect(textOf(renderer)).toContain(SHARE_FAILED);
  });
});
