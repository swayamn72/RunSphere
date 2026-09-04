import React from 'react';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

const native =
  (name: string) =>
  ({ children, ...props }: Record<string, unknown>) =>
    React.createElement(name as React.ElementType, props, children as React.ReactNode);

vi.mock('react-native', () => ({
  Pressable: native('Pressable'),
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: native('Text'),
  View: native('View')
}));

vi.mock('../theme/theme', () => ({
  useAppTheme: () => ({
    colorScheme: 'light',
    reduceMotion: true,
    tokens: {
      text: { primary: '#0B1F17', secondary: '#4A5D55', onAccent: '#FFFFFF' },
      background: { surface: '#FFFFFF', surfaceInset: '#F1F5F2' },
      border: { subtle: '#DCE5E0' },
      action: { primary: '#087B69' },
      mascot: {
        body: '#D9EAE0',
        outline: '#386755',
        orbit: '#5D8500',
        pointer: '#087B69',
        eye: '#10251F',
        beacon: '#8FBD18'
      }
    }
  })
}));

const { LoopCallout } = await import('./LoopCallout.js');
const { loopGuidance } = await import('../loop-guidance.js');

const render = async (element: React.ReactElement) => {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(element);
  });
  return renderer;
};

describe('LoopCallout', () => {
  it('announces the cue as one polite unit naming who is speaking', async () => {
    const renderer = await render(<LoopCallout cue="quest-empty" onDismiss={() => undefined} />);
    const card = renderer.root.findAllByType('View' as React.ElementType)[0]!;

    expect(card.props.accessible).toBe(true);
    expect(card.props.accessibilityLiveRegion).toBe('polite');
    expect(card.props.accessibilityLabel).toBe(`Mira says: ${loopGuidance['quest-empty'].message}`);
  });

  it('gives dismiss its own labelled control explaining what it hides', async () => {
    const dismiss = vi.fn();
    const renderer = await render(<LoopCallout cue="play-empty" onDismiss={dismiss} />);
    const button = renderer.root
      .findAllByType('Pressable' as React.ElementType)
      .find((node) => String(node.props.accessibilityLabel).startsWith('Dismiss'))!;

    expect(button.props.accessibilityRole).toBe('button');
    expect(button.props.accessibilityLabel).toBe('Dismiss guidance from Coda');
    expect(button.props.accessibilityHint).toContain('stays on the screen');
    act(() => button.props.onPress());
    expect(dismiss).toHaveBeenCalledOnce();
  });

  it('offers an optional action as a separate labelled control', async () => {
    const press = vi.fn();
    const renderer = await render(
      <LoopCallout
        cue="hike-prep"
        onDismiss={() => undefined}
        action={{ label: 'Open safety sharing', onPress: press }}
      />
    );
    const button = renderer.root
      .findAllByType('Pressable' as React.ElementType)
      .find((node) => node.props.accessibilityLabel === 'Open safety sharing')!;

    act(() => button.props.onPress());
    expect(press).toHaveBeenCalledOnce();
  });

  it('renders the crew mascot decoratively, so the message is not read twice', async () => {
    const renderer = await render(<LoopCallout cue="pending-result" onDismiss={() => undefined} />);
    const mascot = renderer.root
      .findAllByType('View' as React.ElementType)
      .find((node) => node.props.accessible === false)!;

    expect(mascot.props.accessibilityLabel).toBeUndefined();
  });

  it('renders every cue without tripping the tone guard', async () => {
    for (const cue of Object.keys(loopGuidance) as (keyof typeof loopGuidance)[])
      await expect(
        render(<LoopCallout cue={cue} onDismiss={() => undefined} />)
      ).resolves.toBeDefined();
  });
});
