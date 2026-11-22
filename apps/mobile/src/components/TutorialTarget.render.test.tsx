import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { createTargetRegistry } from '../tutorial-targets.js';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const native = vi.hoisted(() => ({
  turn: [] as (() => void)[],
  keyboard: [] as (() => void)[]
}));

vi.mock('react-native', async () => {
  const React = await import('react');
  return {
    View: React.forwardRef((props: Record<string, unknown>, ref) =>
      React.createElement('View', { ...props, ref }, props.children as React.ReactNode)
    ),
    Dimensions: {
      addEventListener: (_event: string, handler: () => void) => {
        native.turn.push(handler);
        return { remove: () => native.turn.splice(native.turn.indexOf(handler), 1) };
      }
    },
    Keyboard: {
      addListener: (_event: string, handler: () => void) => {
        native.keyboard.push(handler);
        return { remove: () => native.keyboard.splice(native.keyboard.indexOf(handler), 1) };
      }
    }
  };
});

const { TutorialTarget } = await import('./TutorialTarget.js');

describe('tour targets (M9 9.22)', () => {
  it('reports only real rectangles, and only when they change', () => {
    const registry = createTargetRegistry();
    const seen: unknown[] = [];
    registry.subscribe('run', (rect) => seen.push(rect));
    registry.report('run', { x: 1, y: 2, width: 3, height: 4 });
    registry.report('run', { x: 1.2, y: 2, width: 3, height: 4 });
    registry.report('run', { x: 0, y: 0, width: 0, height: 0 });
    expect(seen).toEqual([{ x: 1, y: 2, width: 3, height: 4 }, undefined]);
    expect(registry.rect('run')).toBeUndefined();
  });

  it('measures on layout, turning, the keyboard and when the tour asks, and forgets on unmount', async () => {
    const registry = createTargetRegistry();
    let y = 100;
    const element = (
      <TutorialTarget id="tab-run" registry={registry}>
        {null}
      </TutorialTarget>
    );
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(element, {
        createNodeMock: () => ({
          measureInWindow: (callback: (x: number, y: number, w: number, h: number) => void) =>
            callback(10, y, 80, 48)
        })
      });
    });
    const view = renderer.root.findByType('View' as React.ElementType);
    await act(async () => {
      view.props.onLayout();
    });
    expect(registry.rect('tab-run')).toEqual({ x: 10, y: 100, width: 80, height: 48 });

    y = 300;
    await act(async () => native.turn.at(-1)!());
    expect(registry.rect('tab-run')?.y).toBe(300);
    y = 200;
    await act(async () => native.keyboard.at(-1)!());
    expect(registry.rect('tab-run')?.y).toBe(200);
    y = 150;
    await act(async () => registry.requestMeasure());
    expect(registry.rect('tab-run')?.y).toBe(150);

    await act(async () => renderer.unmount());
    expect(registry.rect('tab-run')).toBeUndefined();
    expect(native.turn).toHaveLength(0);
    expect(native.keyboard).toHaveLength(0);
  });
});
