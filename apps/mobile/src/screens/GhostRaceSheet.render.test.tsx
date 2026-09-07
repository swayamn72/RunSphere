import React from 'react';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GhostTraceResponse } from '@runsphere/contracts';
import type { MobileApiClient } from '../api-client';
import { ApiFailure } from '../api-client';
import type { GhostRun } from './ghost-race-model';

vi.mock('react-native', async () => {
  const React = await import('react');
  const native =
    (name: string) =>
    ({ children, ...props }: Record<string, unknown>) =>
      React.createElement(name as React.ElementType, props, children as React.ReactNode);
  return {
    Pressable: native('Pressable'),
    StyleSheet: { create: <T,>(styles: T) => styles },
    Text: native('Text'),
    View: native('View')
  };
});
vi.mock('../maps/MapSurface', () => ({ MapSurface: () => null }));
vi.mock('../components/primitives', async () => {
  const React = await import('react');
  return {
    PrimaryButton: ({ label, onPress }: { label: string; onPress: () => void }) =>
      React.createElement('Pressable', { accessibilityLabel: label, onPress })
  };
});
vi.mock('../components/styles', () => ({
  useAppStyles: () => new Proxy({}, { get: () => ({}) })
}));

const { GhostRaceSheet } = await import('./GhostRaceSheet.js');

const METRES_PER_DEGREE = (6_378_137 * Math.PI) / 180;

const trace = (overrides: Partial<GhostTraceResponse> = {}): GhostTraceResponse => ({
  claimId: '11111111-1111-4111-8111-111111111111',
  owner: {
    id: '22222222-2222-4222-8222-222222222222',
    displayName: 'Mira',
    avatarKey: 'orbit-01',
    isSelf: false
  },
  points: Array.from({ length: 9 }, (_unused, index) => ({
    at: [72.838, 19.028 + (index * 120) / METRES_PER_DEGREE] as [number, number],
    elapsedSeconds: index * 20
  })),
  distanceMetres: 960,
  durationSeconds: 160,
  trimMetres: 200,
  recordedOn: '2026-09-04',
  privacyNote: 'The route is trimmed by 200 m at both ends.',
  rulesNote: 'A ghost changes nothing about the contest.',
  viewsRemaining: 2,
  ...overrides
});

const getGhostTrace = vi.fn((_claimId: string) => Promise.resolve(trace()));
const api = () =>
  ({ getGhostTrace: (id: string) => getGhostTrace(id) }) as unknown as MobileApiClient;

const started: GhostRun[] = [];
let cancelled = 0;
let expired = 0;

const render = async (): Promise<ReactTestRenderer> => {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <GhostRaceSheet
        api={api()}
        claimId="11111111-1111-4111-8111-111111111111"
        holderName="Mira"
        onStart={(run) => started.push(run)}
        onCancel={() => {
          cancelled += 1;
        }}
        onSessionExpired={() => {
          expired += 1;
        }}
      />
    );
  });
  return renderer;
};

const texts = (renderer: ReactTestRenderer): string[] =>
  renderer.root
    .findAllByType('Text' as never)
    .flatMap((node) => (Array.isArray(node.props.children) ? [] : [String(node.props.children)]));

const press = async (renderer: ReactTestRenderer, label: string): Promise<void> => {
  const target = renderer.root
    .findAllByType('Pressable' as never)
    .find((node) => String(node.props.accessibilityLabel ?? '') === label);
  if (!target) throw new Error(`No pressable labelled "${label}"`);
  await act(async () => {
    (target.props.onPress as () => void)();
  });
};

beforeEach(() => {
  getGhostTrace.mockReset();
  getGhostTrace.mockResolvedValue(trace());
  started.length = 0;
  cancelled = 0;
  expired = 0;
});

describe('the ghost race confirmation', () => {
  it('asks for the trace once, because asking is what costs a view', async () => {
    await render();

    expect(getGhostTrace).toHaveBeenCalledTimes(1);
    expect(getGhostTrace).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');
  });

  it('says who, how far, how long, and when', async () => {
    const shown = texts(await render());

    expect(shown).toContain("Race Mira's ghost");
    expect(shown).toContain('Mira covered 1.0 km of this loop in 2:40.');
    expect(shown).toContain('Recorded on 2026-09-04.');
  });

  it('states the trim and that no rule changes, every time', async () => {
    const shown = texts(await render());

    expect(shown).toContain('The route is trimmed by 200 m at both ends.');
    expect(shown).toContain('A ghost changes nothing about the contest.');
  });

  it('hands the run a ghost, not the whole response', async () => {
    const renderer = await render();
    await press(renderer, 'Start ghost race');

    expect(started).toHaveLength(1);
    expect(started[0]?.holderName).toBe('Mira');
    expect(started[0]?.trace.points).toHaveLength(9);
    expect(started[0]).not.toHaveProperty('viewsRemaining');
  });

  it('warns when that was the last view of the hour', async () => {
    getGhostTrace.mockResolvedValue(trace({ viewsRemaining: 0 }));

    expect(texts(await render())).toContain('That was your last ghost race this hour.');
  });

  it('says nothing about a budget when there is room left', async () => {
    expect(texts(await render()).join(' ')).not.toContain('last ghost race');
  });

  it('reads a rate limit as a limit, and still offers a way out', async () => {
    getGhostTrace.mockRejectedValue(new ApiFailure(429, 'too many'));

    const renderer = await render();

    // Nothing is broken and the run can still happen — the sheet says so
    // rather than showing an error.
    expect(texts(renderer).join(' ')).toContain('does not need one');
    // And there is no start button to press, because there is no ghost.
    expect(
      renderer.root
        .findAllByType('Pressable' as never)
        .map((node) => String(node.props.accessibilityLabel))
    ).toEqual(['Cancel']);
    await press(renderer, 'Cancel');
    expect(cancelled).toBe(1);
  });

  it('explains a refusal without calling it a failure', async () => {
    getGhostTrace.mockRejectedValue(new ApiFailure(404, 'no trace'));

    expect(texts(await render()).join(' ')).toContain('still run the loop');
  });

  it('hands a dead session up rather than showing an error', async () => {
    const { AuthFailure } = await import('../auth-failure.js');
    getGhostTrace.mockRejectedValue(new AuthFailure('invalid-credentials'));

    await render();

    expect(expired).toBe(1);
  });
});
