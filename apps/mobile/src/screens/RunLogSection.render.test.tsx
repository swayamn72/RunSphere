import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { RunLogItem } from '@runsphere/contracts';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', async () => {
  const React = await import('react');
  const native =
    (name: string) =>
    ({ children, ...props }: Record<string, unknown>) =>
      React.createElement(name as React.ElementType, props, children as React.ReactNode);
  return { Pressable: native('Pressable'), Text: native('Text'), View: native('View') };
});
vi.mock('react-native-svg', async () => {
  const React = await import('react');
  const native =
    (name: string) =>
    ({ children, ...props }: Record<string, unknown>) =>
      React.createElement(name as React.ElementType, props, children as React.ReactNode);
  return { default: native('Svg'), Path: native('Path'), Circle: native('Circle') };
});
vi.mock('../components/styles', () => ({ useAppStyles: () => new Proxy({}, { get: () => ({}) }) }));
vi.mock('../theme/theme', () => ({
  useAppTheme: () => ({
    tokens: {
      action: { primary: 'action' },
      status: { success: 'success' },
      text: { primary: 'text' }
    }
  })
}));

const { RunLogSection } = await import('./RunLogSection.js');

const run = (id: string, startedOn: string): RunLogItem => ({
  id,
  startedOn,
  distanceMeters: 5_000,
  durationSeconds: 1_500,
  movingSeconds: 1_500,
  paceSecondsPerKm: 300,
  elevationGainMeters: null,
  runMode: 'free',
  result: {},
  route: [
    [
      [0, 0],
      [0.001, 0.001]
    ]
  ]
});

type Node = ReactTestRenderer['root'];
const nodeTexts = (root: Node) =>
  root
    .findAll((node) => (node.type as unknown) === 'Text')
    .map((node) => [node.props.children].flat().join(''));
const texts = (renderer: ReactTestRenderer) => nodeTexts(renderer.root);

const mount = async (element: React.ReactElement) => {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(element);
  });
  return renderer;
};

describe('run log section (M9 9.15)', () => {
  it('shows cards by week with a drawn route, and loads more on request', async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce({
        data: [run('a', '2026-11-17'), run('b', '2026-11-03')],
        nextCursor: 'next'
      })
      .mockResolvedValueOnce({ data: [run('c', '2026-10-01')], nextCursor: null });
    const opened: string[] = [];
    const renderer = await mount(
      <RunLogSection load={load} owner onOpenRun={(item) => opened.push(item.id)} />
    );
    const shown = texts(renderer);
    expect(shown).toEqual(
      expect.arrayContaining(['Runs', 'Tue 17 Nov · FREE RUN', '5.00 km · 25:00'])
    );
    expect(renderer.root.findAll((node) => (node.type as unknown) === 'Path')).toHaveLength(2);
    expect(
      shown.filter((line) => line.startsWith('WEEK OF') || line.endsWith('WEEK'))
    ).toHaveLength(2);

    const more = renderer.root.find(
      (node) => (node.type as unknown) === 'Pressable' && nodeTexts(node).includes('Show more')
    );
    await act(async () => {
      more.props.onPress();
    });
    expect(load).toHaveBeenLastCalledWith('next');
    expect(texts(renderer)).toContain('Thu 1 Oct · FREE RUN');
    expect(texts(renderer)).not.toContain('Show more');

    const card = renderer.root.find(
      (node) =>
        (node.type as unknown) === 'Pressable' &&
        String(node.props.accessibilityLabel).startsWith('Tue 17 Nov')
    );
    await act(async () => {
      card.props.onPress();
    });
    // Not laid out in a test renderer, so there is no rectangle to grow from.
    expect(opened).toEqual(['a']);
  });

  it('says when someone keeps their runs to themselves, and when yours are empty', async () => {
    const hidden = await mount(
      <RunLogSection
        load={async () => ({ visible: false, data: [], nextCursor: null })}
        owner={false}
      />
    );
    expect(texts(hidden)).toContain('This runner keeps their runs to themselves.');
    const empty = await mount(
      <RunLogSection load={async () => ({ data: [], nextCursor: null })} owner />
    );
    expect(texts(empty)).toContain('No counted runs yet. Your runs show here once they count.');
  });

  it('offers a retry when the runs could not load', async () => {
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ data: [run('a', '2026-11-17')], nextCursor: null });
    const renderer = await mount(<RunLogSection load={load} owner />);
    const retry = renderer.root.find(
      (node) =>
        (node.type as unknown) === 'Pressable' &&
        nodeTexts(node).some((line) => line.endsWith('Tap to try again.'))
    );
    await act(async () => {
      retry.props.onPress();
    });
    expect(texts(renderer)).toContain('5.00 km · 25:00');
  });
});
