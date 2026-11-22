import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { createTargetRegistry } from '../tutorial-targets.js';
import { TOUR_STEPS, tourReducer, type TourState } from '../tutorial-model.js';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', async () => {
  const React = await import('react');
  const host =
    (name: string) =>
    ({ children, ...props }: Record<string, unknown>) =>
      React.createElement(name as React.ElementType, props, children as React.ReactNode);
  return {
    Platform: { OS: 'android', Version: 34 },
    StyleSheet: { absoluteFill: {} },
    Pressable: host('Pressable'),
    Text: host('Text'),
    View: host('View'),
    useWindowDimensions: () => ({ width: 400, height: 800 })
  };
});
vi.mock('./styles', () => ({ useAppStyles: () => new Proxy({}, { get: () => ({}) }) }));
vi.mock('../theme/theme', () => ({
  useAppTheme: () => ({
    reduceMotion: true,
    tokens: {
      action: { primary: 'a' },
      scrim: { subtle: 's', strong: 'S' },
      mascot: { body: 'b', outline: 'o', eye: 'e', beacon: 'n' }
    }
  })
}));

const { TutorialOverlay } = await import('./TutorialOverlay.js');

const textOf = (node: ReactTestRenderer['root']) => [node.props.children].flat().join('');
const texts = (renderer: ReactTestRenderer) =>
  renderer.root.findAll((node) => (node.type as unknown) === 'Text').map(textOf);
const button = (renderer: ReactTestRenderer, label: string) =>
  renderer.root.find(
    (node) =>
      (node.type as unknown) === 'Pressable' &&
      node.findAll((inner) => (inner.type as unknown) === 'Text').some((t) => textOf(t) === label)
  );
const styleOf = (node: ReactTestRenderer['root']) =>
  Object.assign({}, ...[node.props.style].flat(3)) as Record<string, number>;

function Harness({
  registry,
  onShowTab
}: {
  registry: ReturnType<typeof createTargetRegistry>;
  onShowTab: (tab: string) => void;
}) {
  const [state, setState] = React.useState<TourState>({ index: 0 });
  return state === 'done' ? (
    React.createElement('Finished' as React.ElementType)
  ) : (
    <TutorialOverlay
      state={state}
      onAction={(action) => setState((current) => tourReducer(current, action))}
      activeTab="Home"
      onShowTab={onShowTab as never}
      registry={registry}
    />
  );
}

describe('tour overlay (M9 9.23)', () => {
  it('spotlights the step’s button with a ring and four blurred panels, and only its buttons move it', async () => {
    const registry = createTargetRegistry();
    registry.report('tab-run', { x: 160, y: 740, width: 80, height: 50 });
    const onShowTab = vi.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<Harness registry={registry} onShowTab={onShowTab} />);
    });
    expect(texts(renderer)).toEqual(
      expect.arrayContaining(['STEP 1 OF 6', TOUR_STEPS[0]!.title, TOUR_STEPS[0]!.rhoLine])
    );
    expect(renderer.root.findAll((node) => (node.type as unknown) === 'BlurView')).toHaveLength(4);
    const ring = renderer.root
      .findAll((node) => (node.type as unknown) === 'Animated.View')
      .find((node) => styleOf(node).borderRadius === 16)!;
    expect(styleOf(ring)).toMatchObject({ left: 154, top: 734, width: 92, height: 62 });

    // A tap anywhere else is taken by the overlay and does nothing.
    const root = renderer.root.findAll((node) => node.props.accessibilityViewIsModal)[0]!;
    expect(root.props.onStartShouldSetResponder()).toBe(true);
    expect(button(renderer, 'Back').props.disabled).toBe(true);

    await act(async () => button(renderer, 'Next').props.onPress());
    expect(texts(renderer)).toContain('STEP 2 OF 6');
    await act(async () => button(renderer, 'Back').props.onPress());
    expect(texts(renderer)).toContain('STEP 1 OF 6');
    await act(async () => button(renderer, 'Skip').props.onPress());
    expect(renderer.root.findAll((node) => (node.type as unknown) === 'Finished')).toHaveLength(1);
  });

  it('switches to the step’s tab first, and still shows the bubble before the button is measured', async () => {
    const registry = createTargetRegistry();
    const onShowTab = vi.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <TutorialOverlay
          state={{ index: 2 }}
          onAction={vi.fn()}
          activeTab="Home"
          onShowTab={onShowTab}
          registry={registry}
        />
      );
    });
    expect(onShowTab).toHaveBeenCalledWith('Map');
    expect(texts(renderer)).toContain(TOUR_STEPS[2]!.title);
    await act(async () => registry.report('tab-map', { x: 80, y: 740, width: 80, height: 50 }));
    expect(
      renderer.root
        .findAll((node) => (node.type as unknown) === 'Animated.View')
        .some((node) => styleOf(node).borderRadius === 16)
    ).toBe(true);
  });
});
