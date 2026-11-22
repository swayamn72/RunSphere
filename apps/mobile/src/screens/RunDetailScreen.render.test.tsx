import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { RunLogItem } from '@runsphere/contracts';

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
    PanResponder: { create: () => ({ panHandlers: {} }) },
    Pressable: host('Pressable'),
    Text: host('Text'),
    View: host('View'),
    useWindowDimensions: () => ({ width: 400, height: 800 })
  };
});
vi.mock('../components/styles', () => ({ useAppStyles: () => new Proxy({}, { get: () => ({}) }) }));
vi.mock('../theme/theme', () => ({
  useAppTheme: () => ({
    tokens: {
      action: { primary: 'a' },
      status: { success: 's' },
      text: { primary: 't', secondary: 't2' }
    }
  })
}));
vi.mock('./RunDetailMap', () => ({ RunDetailMap: () => null }));

const { RunDetailScreen } = await import('./RunDetailScreen.js');

const item: RunLogItem = {
  id: 'run-1',
  startedOn: '2026-11-17',
  startedAt: '2026-11-17T00:45:00.000Z',
  distanceMeters: 2_000,
  durationSeconds: 600,
  movingSeconds: 600,
  paceSecondsPerKm: 300,
  elevationGainMeters: null,
  runMode: 'turf',
  result: { claimedAreaSqm: 48_200 },
  route: [
    [
      [0, 0],
      [0, 0.01]
    ]
  ]
};

const split = (km: number, pace: number) => ({
  km,
  distanceMeters: 1_000,
  movingSeconds: pace,
  paceSecondsPerKm: pace,
  elevationChangeMeters: null,
  partial: false
});

const metrics = {
  metricsVersion: 1,
  elapsedSeconds: 620,
  activeSeconds: 600,
  movingSeconds: 600,
  distanceMeters: 2_000,
  averagePaceSecondsPerKm: 300,
  movingPaceSecondsPerKm: 300,
  splits: [split(1, 290), split(2, 310)],
  fastestSplitKm: 1,
  bestEfforts: [{ key: '1k', distanceMeters: 1_000, seconds: 290 }],
  elevation: null,
  paceSeries: [
    [0, 290],
    [2_000, 310]
  ],
  elevationSeries: []
};

const textOf = (node: ReactTestRenderer['root']) => [node.props.children].flat().join('');
const texts = (renderer: ReactTestRenderer) =>
  renderer.root.findAll((node) => (node.type as unknown) === 'Text').map(textOf);
const press = async (renderer: ReactTestRenderer, label: string) => {
  const node = renderer.root.find(
    (candidate) =>
      (candidate.type as unknown) === 'Pressable' &&
      candidate
        .findAll((inner) => (inner.type as unknown) === 'Text')
        .some((inner) => textOf(inner) === label)
  );
  await act(async () => {
    await node.props.onPress();
  });
};

const mount = async (
  owner: boolean,
  deleteActivity: () => Promise<void> = vi.fn(async () => undefined)
) => {
  const api = {
    activityStatus: vi.fn(async () => ({ id: 'run-1', status: 'derived', metrics })),
    deleteActivity: vi.fn(deleteActivity)
  };
  const close = vi.fn();
  const onDeleted = vi.fn();
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <RunDetailScreen
        run={{ item, owner, onDeleted }}
        close={close}
        dragHandlers={{}}
        progress={{ value: 1 } as never}
        reduceMotion
        api={api as never}
      />
    );
  });
  return { renderer, api, close, onDeleted };
};

describe('run detail layout (M9 9.19)', () => {
  it('shows your run’s result, stats, splits, chart and best efforts', async () => {
    const { renderer, api } = await mount(true);
    expect(api.activityStatus).toHaveBeenCalledWith('run-1');
    const shown = texts(renderer);
    expect(shown).toEqual(
      expect.arrayContaining([
        'Claimed 48,200 m²',
        'Moving time',
        'Elapsed',
        'Best km',
        'SPLITS',
        'Km 1 · Best',
        'PACE',
        'BEST EFFORTS',
        '1 km',
        'Delete run'
      ])
    );
    // No elevation recorded: no elevation chart.
    expect(shown).not.toContain('ELEVATION');
  });

  it('asks before deleting, deletes, drops it from the list and closes', async () => {
    const { renderer, api, close, onDeleted } = await mount(true);
    await press(renderer, 'Delete run');
    expect(texts(renderer)).toContain('Delete this run? It comes off your profile for good.');
    await press(renderer, 'Keep it');
    expect(api.deleteActivity).not.toHaveBeenCalled();
    await press(renderer, 'Delete run');
    await press(renderer, 'Yes, delete it');
    expect(api.deleteActivity).toHaveBeenCalledWith('run-1');
    expect(onDeleted).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });

  it('says so and stays open when deleting fails', async () => {
    const { renderer, close } = await mount(true, async () => {
      throw new Error('offline');
    });
    await press(renderer, 'Delete run');
    await press(renderer, 'Yes, delete it');
    expect(close).not.toHaveBeenCalled();
    expect(texts(renderer).some((line) => /try again/.test(line))).toBe(true);
  });

  it('shows someone else’s run as their settings allow (9.20)', async () => {
    // Start times hidden: the day only. Route maps off: no map, and a line saying so.
    const dayOnly: RunLogItem = { ...item, route: null };
    delete dayOnly.startedAt;
    const props = {
      close: vi.fn(),
      dragHandlers: {},
      progress: { value: 1 } as never,
      reduceMotion: true,
      api: { activityStatus: vi.fn(), deleteActivity: vi.fn() } as never
    };
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<RunDetailScreen run={{ item: dayOnly, owner: false }} {...props} />);
    });
    expect(texts(renderer)).toContain('Tue 17 Nov');
    expect(texts(renderer).some((line) => line.includes('·') && line.startsWith('Tue'))).toBe(
      false
    );
    expect(texts(renderer)).toContain('This runner keeps their route maps to themselves.');
    expect(renderer.root.findAll((node) => (node.type as unknown) === 'Svg')).toHaveLength(0);

    // Times shown and the route trimmed on the server: both appear as given.
    await act(async () => {
      renderer.update(<RunDetailScreen run={{ item, owner: false }} {...props} />);
    });
    expect(texts(renderer)).toContain('Tue 17 Nov · 6:15');
    expect(texts(renderer)).not.toContain('This runner keeps their route maps to themselves.');
  });

  it('shows someone else’s run without loading splits or offering Delete', async () => {
    const { renderer, api } = await mount(false);
    expect(api.activityStatus).not.toHaveBeenCalled();
    expect(texts(renderer)).not.toContain('Delete run');
    expect(texts(renderer)).not.toContain('SPLITS');
  });
});
