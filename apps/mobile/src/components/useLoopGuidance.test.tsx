import React from 'react';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  View: ({ children, ...props }: Record<string, unknown>) =>
    React.createElement('View' as React.ElementType, props, children as React.ReactNode)
}));

import type { LoopGuidanceCue, LoopGuidanceMemory, LoopGuidanceStore } from '../loop-guidance.js';

const { useLoopGuidance } = await import('./useLoopGuidance.js');
const { createMemoryGuidanceStore, emptyGuidanceMemory, recordGuidanceShown, recordWeekSeen } =
  await import('../loop-guidance.js');

const NOW = new Date('2026-09-04T09:00:00.000Z');

const trackingStore = (initial: LoopGuidanceMemory = emptyGuidanceMemory) => {
  const inner = createMemoryGuidanceStore(initial);
  const saved: LoopGuidanceMemory[] = [];
  const store: LoopGuidanceStore = {
    read: () => inner.read(),
    save: (memory) => {
      saved.push(memory);
      return inner.save(memory);
    }
  };
  return { store, saved };
};

const mount = async (
  candidates: readonly LoopGuidanceCue[],
  store: LoopGuidanceStore,
  week?: string
) => {
  const seen: { cue: LoopGuidanceCue | undefined; dismiss: () => void }[] = [];
  function Probe() {
    seen.push(useLoopGuidance(candidates, { store, now: () => NOW, week }));
    return React.createElement('View' as React.ElementType, null);
  }
  const element = React.createElement(Probe);
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(element);
  });
  return {
    latest: () => seen[seen.length - 1]!,
    rerender: () => act(async () => renderer.update(element))
  };
};

describe('useLoopGuidance', () => {
  it('resolves one cue and charges its frequency cap exactly once', async () => {
    const { store, saved } = trackingStore();
    const probe = await mount(['challenge-invite', 'play-empty'], store);

    expect(probe.latest().cue).toBe('challenge-invite');
    expect(saved).toHaveLength(1);
    expect(saved[0]!.shown['challenge-invite']).toEqual({ day: '2026-09-04', count: 1 });
  });

  it('shows nothing when the surface offers no candidates', async () => {
    const { store, saved } = trackingStore();
    const probe = await mount([], store);

    expect(probe.latest().cue).toBeUndefined();
    expect(saved).toHaveLength(0);
  });

  it('respects a cap the memory already spent', async () => {
    const spent = recordGuidanceShown(emptyGuidanceMemory, 'play-empty', NOW);
    const { store } = trackingStore(spent);
    const probe = await mount(['play-empty'], store);

    expect(probe.latest().cue).toBeUndefined();
  });

  it('records the dismissal and hides the cue immediately', async () => {
    const { store, saved } = trackingStore();
    const probe = await mount(['quest-empty'], store);

    await act(async () => probe.latest().dismiss());

    expect(probe.latest().cue).toBeUndefined();
    expect(saved.at(-1)!.dismissed['quest-empty']).toBe('2026-09-04');
  });

  it('holds the resolved cue steady rather than re-resolving on every render', async () => {
    const { store, saved } = trackingStore();
    const probe = await mount(['challenge-invite'], store);

    await probe.rerender();

    expect(probe.latest().cue).toBe('challenge-invite');
    expect(saved).toHaveLength(1);
  });

  it('stays silent about a weekly reset on a first run and records the week', async () => {
    const { store, saved } = trackingStore();
    const probe = await mount(['weekly-reset'], store, '2026-09-07');

    expect(probe.latest().cue).toBeUndefined();
    expect(saved.at(-1)!.lastWeekSeen).toBe('2026-09-07');
  });

  it('raises the weekly reset once the stored week has actually moved', async () => {
    const { store } = trackingStore(recordWeekSeen(emptyGuidanceMemory, '2026-08-31'));
    const probe = await mount(['weekly-reset'], store, '2026-09-07');

    expect(probe.latest().cue).toBe('weekly-reset');
  });
});
