import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { RunLogItem } from '@runsphere/contracts';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const native = vi.hoisted(() => ({
  back: [] as (() => boolean)[],
  responders: [] as Record<string, (...args: unknown[]) => unknown>[]
}));

vi.mock('react-native', async () => {
  const React = await import('react');
  const host =
    (name: string) =>
    ({ children, ...props }: Record<string, unknown>) =>
      React.createElement(name as React.ElementType, props, children as React.ReactNode);
  return {
    BackHandler: {
      addEventListener: (_event: string, handler: () => boolean) => {
        native.back.push(handler);
        return { remove: () => native.back.splice(native.back.indexOf(handler), 1) };
      }
    },
    PanResponder: {
      create: (config: Record<string, (...args: unknown[]) => unknown>) => {
        native.responders.push(config);
        return { panHandlers: { onDragTest: config } };
      }
    },
    StyleSheet: { absoluteFill: {} },
    Pressable: host('Pressable'),
    Text: host('Text'),
    View: host('View')
  };
});
vi.mock('../theme/theme', () => ({
  useAppTheme: () => ({ tokens: { background: { canvas: 'canvas' } } })
}));

const { RunDetailProvider, useOpenRun } = await import('./RunDetailHost.js');

const item = { id: 'run-1' } as RunLogItem;

function Opener() {
  const open = useOpenRun();
  return React.createElement('Opener' as React.ElementType, {
    onPress: () => open?.({ item, owner: true })
  });
}

const mount = async () => {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <RunDetailProvider
        renderDetail={({ run, close }) =>
          React.createElement('Detail' as React.ElementType, { id: run.item.id, close })
        }
      >
        <Opener />
      </RunDetailProvider>
    );
  });
  const open = async () =>
    act(async () => {
      renderer.root.findByType('Opener' as React.ElementType).props.onPress();
    });
  const detail = () => renderer.root.findAllByType('Detail' as React.ElementType);
  return { renderer, open, detail };
};

describe('run detail host (M9 9.16)', () => {
  it('opens over the tabs and closes on Android Back', async () => {
    const { open, detail } = await mount();
    expect(detail()).toHaveLength(0);
    await open();
    expect(detail()[0]!.props.id).toBe('run-1');
    let handled = false;
    await act(async () => {
      handled = native.back.at(-1)!();
    });
    expect(handled).toBe(true);
    expect(detail()).toHaveLength(0);
    // Closed, it no longer takes Back from the screen underneath.
    expect(native.back).toHaveLength(0);
  });

  it('closes on a swipe down, but not on a short one', async () => {
    const { open, detail } = await mount();
    await open();
    const drag = native.responders.at(-1)!;
    await act(async () => {
      drag['onPanResponderRelease']!({}, { dy: 40, vy: 0.1 });
    });
    expect(detail()).toHaveLength(1);
    await act(async () => {
      drag['onPanResponderRelease']!({}, { dy: 140, vy: 0.3 });
    });
    expect(detail()).toHaveLength(0);
  });
});
