import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { Tab } from '../navigation/types.js';
import { createTargetRegistry } from '../tutorial-targets.js';
import { TOUR_STEPS, tourReducer, type TourAction, type TourState } from '../tutorial-model.js';

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
    Platform: { OS: 'android', Version: 30 },
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
const press = async (renderer: ReactTestRenderer, label: string) => {
  const node = renderer.root.find(
    (candidate) =>
      (candidate.type as unknown) === 'Pressable' &&
      candidate
        .findAll((inner) => (inner.type as unknown) === 'Text')
        .some((inner) => textOf(inner) === label)
  );
  await act(async () => node.props.onPress());
};

/** The app's part: the tab showing, the tour state, and finishing once. */
function App({
  registry,
  tabs,
  onFinished
}: {
  registry: ReturnType<typeof createTargetRegistry>;
  tabs: Tab[];
  onFinished: () => void;
}) {
  const [tab, setTab] = React.useState<Tab>('Home');
  const [tour, setTour] = React.useState<TourState | undefined>({ index: 0 });
  const act = (action: TourAction) =>
    setTour((current) => {
      const next = current ? tourReducer(current, action) : current;
      if (next === 'done') {
        onFinished();
        return undefined;
      }
      return next;
    });
  return tour ? (
    <TutorialOverlay
      state={tour}
      onAction={act}
      activeTab={tab}
      onShowTab={(next) => {
        tabs.push(next);
        setTab(next);
      }}
      registry={registry}
    />
  ) : null;
}

describe('first tour after sign-up (M9 9.25)', () => {
  it('walks every step on the right tab, readable by TalkBack, and finishes once', async () => {
    const registry = createTargetRegistry();
    for (const [index, step] of TOUR_STEPS.entries())
      registry.report(step.targetId, { x: 20 + index * 60, y: 740, width: 56, height: 48 });
    const tabs: Tab[] = [];
    const onFinished = vi.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<App registry={registry} tabs={tabs} onFinished={onFinished} />);
    });

    for (const [index, step] of TOUR_STEPS.entries()) {
      const shown = renderer.root.findAll((node) => (node.type as unknown) === 'Text').map(textOf);
      expect(shown).toContain(`STEP ${index + 1} OF ${TOUR_STEPS.length}`);
      expect(shown).toContain(step.title);
      // Focus stays in the tour, and each new step is announced.
      expect(
        renderer.root.findAll(
          (node) => typeof node.type === 'string' && node.props.accessibilityViewIsModal
        )
      ).toHaveLength(1);
      const line = renderer.root.find(
        (node) =>
          (node.type as unknown) === 'Text' && node.props.accessibilityLabel === step.rhoLine
      );
      expect(line).toBeDefined();
      expect(
        renderer.root.findAll((node) => node.props.accessibilityLiveRegion === 'polite')
      ).not.toHaveLength(0);
      await press(renderer, index === TOUR_STEPS.length - 1 ? 'Done' : 'Next');
    }

    expect(tabs).toEqual(['Map', 'Home', 'Profile']);
    expect(onFinished).toHaveBeenCalledTimes(1);
    expect(renderer.toJSON()).toBeNull();
  });
});
