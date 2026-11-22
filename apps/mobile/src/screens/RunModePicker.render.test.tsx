import React from 'react';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

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

const { RunModePicker } = await import('./RunModePicker.js');

const texts = (renderer: ReactTestRenderer) =>
  renderer.root
    .findAll((node) => (node.type as unknown) === 'Text')
    .map((node) => [node.props.children].flat().join(''));
const buttons = (renderer: ReactTestRenderer) =>
  renderer.root.findAll(
    (node) =>
      (node.type as unknown) === 'Pressable' &&
      (node.props as { accessibilityRole?: string }).accessibilityRole === 'button'
  );

describe('run mode picker (M9 9.6)', () => {
  it('shows four large cards that each say what the run does', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<RunModePicker onPick={() => undefined} />);
    });
    expect(texts(renderer)).toEqual(
      expect.arrayContaining(['Pick your run', 'Free run', 'Turf', 'Quest', 'Ghost Race'])
    );
    expect(buttons(renderer).map((node) => node.props.accessibilityLabel)).toEqual([
      'Free run. Just run. Distance, time and pace.',
      'Turf. Close a loop to claim the ground inside it.',
      'Quest. Pass every stop of a quest you’ve taken on.',
      'Ghost Race. Race a rival’s loop to take their ground.'
    ]);
  });

  it('reports the mode picked', async () => {
    const onPick = vi.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<RunModePicker onPick={onPick} />);
    });
    for (const node of buttons(renderer))
      await act(async () => (node.props as { onPress: () => void }).onPress());
    expect(onPick.mock.calls.map(([mode]) => mode)).toEqual(['free', 'turf', 'quest', 'ghost']);
  });
});
