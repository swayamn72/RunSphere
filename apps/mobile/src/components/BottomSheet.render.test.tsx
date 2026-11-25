import React from 'react';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { themeMock } from '../theme/theme-mock';

vi.mock('react-native', async () => {
  const React = await import('react');
  const native =
    (name: string) =>
    ({ children, ...props }: Record<string, unknown>) =>
      React.createElement(name as React.ElementType, props, children as React.ReactNode);
  return {
    Modal: native('Modal'),
    Pressable: native('Pressable'),
    ScrollView: native('ScrollView'),
    StyleSheet: { create: <T,>(styles: T) => styles, absoluteFill: {} },
    Text: native('Text'),
    View: native('View')
  };
});
vi.mock('../theme/theme', () => themeMock());

const { BottomSheet } = await import('./BottomSheet.js');
const { Toast } = await import('./Toast.js');

describe('BottomSheet', () => {
  it('names itself with a header and closes from the scrim', async () => {
    const onClose = vi.fn();
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(
        <BottomSheet visible title="Fair Play" onClose={onClose} actions={<React.Fragment />}>
          <React.Fragment>Body</React.Fragment>
        </BottomSheet>
      );
    });
    const header = renderer.root.findAll(
      (node) =>
        typeof node.type === 'string' &&
        (node.props as { accessibilityRole?: string }).accessibilityRole === 'header'
    );
    expect(header).toHaveLength(1);
    const close = renderer.root.find(
      (node) =>
        typeof node.type === 'string' &&
        (node.props as { accessibilityLabel?: string }).accessibilityLabel === 'Close'
    );
    await act(async () => {
      (close.props as { onPress: () => void }).onPress();
    });
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe('Toast', () => {
  it('shows nothing without a message and dismisses itself after the delay', async () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(<Toast message={undefined} onDone={onDone} />);
    });
    expect(renderer.toJSON()).toBeNull();
    await act(async () => {
      renderer.update(<Toast message="Saved." onDone={onDone} durationMs={1000} />);
    });
    expect(renderer.toJSON()).not.toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(onDone).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
