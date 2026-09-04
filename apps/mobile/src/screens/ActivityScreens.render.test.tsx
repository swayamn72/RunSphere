import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActivitySession } from '../activity-recorder-core.js';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  recorder: {
    get: vi.fn(),
    liveSamples: vi.fn(),
    heartbeat: vi.fn(),
    transition: vi.fn(),
    appendSample: vi.fn(),
    list: vi.fn()
  }
}));

vi.mock('expo-location', () => ({}));
vi.mock('react-native', async () => {
  const React = await import('react');
  const native =
    (name: string) =>
    ({ children, ...props }: Record<string, unknown>) =>
      React.createElement(name as React.ElementType, props, children as React.ReactNode);
  return {
    AppState: { addEventListener: () => ({ remove: vi.fn() }) },
    Linking: { openSettings: vi.fn() },
    Pressable: native('Pressable'),
    Text: native('Text'),
    View: native('View')
  };
});
vi.mock('../activity-recorder.native', () => ({ activityRecorder: mocks.recorder }));
vi.mock('../location-adapter', () => ({
  recordingLocationAdapter: { subscribe: vi.fn().mockResolvedValue({ remove: vi.fn() }) }
}));
vi.mock('../components/styles', () => ({ useAppStyles: () => new Proxy({}, { get: () => ({}) }) }));
// Guidance has its own render tests; this file is about lifecycle, and the
// callout would otherwise need the whole theme provider.
vi.mock('../components/LoopCallout', () => ({ LoopCallout: () => null }));
vi.mock('../components/primitives', async () => {
  const React = await import('react');
  return {
    MovementChoice: () => null,
    PrimaryButton: ({ label, onPress }: { label: string; onPress: () => void }) =>
      React.createElement('PrimaryButton' as React.ElementType, { label, onPress }),
    Stat: () => null
  };
});
vi.mock('../maps/MapSurface', async () => {
  const React = await import('react');
  return {
    MapSurface: (props: Record<string, unknown>) =>
      React.createElement('MapSurface' as React.ElementType, props)
  };
});

const {
  ActivityDetail,
  ActivityRecording,
  HISTORY_REFRESH_CONCURRENCY,
  reseedActivityDetailSession,
  refreshHistoryDetails,
  shouldRefreshHistoryDetail
} = await import('./ActivityScreens.js');

const session: ActivitySession = {
  id: 'local-1',
  accountId: 'account-1',
  movementType: 'walk',
  state: 'active',
  startedAt: '2026-08-28T06:00:00Z',
  updatedAt: '2026-08-28T06:01:00Z',
  durationSeconds: 60,
  distanceMeters: 100,
  acceptedSamples: 2,
  lastHeartbeatAt: '2026-08-28T06:01:00Z'
};

const text = (renderer: ReactTestRenderer): string =>
  renderer.root
    .findAllByType('Text' as React.ElementType)
    .flatMap((node) => node.children)
    .filter((value): value is string => typeof value === 'string')
    .join(' ');

describe('activity render lifecycle regressions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.recorder.liveSamples.mockResolvedValue([]);
    mocks.recorder.appendSample.mockResolvedValue(false);
    mocks.recorder.get.mockResolvedValue(session);
    mocks.recorder.heartbeat.mockResolvedValue(undefined);
    mocks.recorder.transition.mockResolvedValue(true);
  });

  it('finishes recording without changing hook order', async () => {
    let stored = { ...session };
    mocks.recorder.get.mockImplementation(async () => stored);
    mocks.recorder.transition.mockImplementation(async (_id, _account, _from, to) => {
      stored = { ...stored, state: to as ActivitySession['state'] };
      return true;
    });
    const sync = { sync: vi.fn(), refresh: vi.fn(), delete: vi.fn(), syncPending: vi.fn() };
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        <ActivityRecording
          session={session}
          accountId={session.accountId}
          onChange={vi.fn()}
          onExit={vi.fn()}
          sync={sync as never}
        />
      );
    });
    const finish = renderer.root
      .findAllByType('Pressable' as React.ElementType)
      .find((node) =>
        node
          .findAllByType('Text' as React.ElementType)
          .some((child) => child.children.includes('Finish activity'))
      );
    expect(finish).toBeDefined();
    await act(async () => {
      finish!.props.onPress();
    });

    expect(text(renderer)).toContain('New ground covered');
  });

  it('bounds history reads and never refreshes terminal server outcomes', async () => {
    const terminal = [
      { ...session, remoteId: 'derived', remoteStatus: 'derived' as const },
      { ...session, remoteId: 'rejected', remoteStatus: 'rejected' as const },
      { ...session, remoteId: 'deleted', remoteStatus: 'deleted' as const }
    ];
    expect(shouldRefreshHistoryDetail(terminal[0]!)).toBe(true);
    expect(terminal.slice(1).every((item) => !shouldRefreshHistoryDetail(item))).toBe(true);

    const pending = Array.from({ length: 5 }, (_, index) => ({
      ...session,
      id: `pending-${index}`,
      remoteId: `remote-${index}`
    }));
    let active = 0;
    let maximumActive = 0;
    const release: Array<() => void> = [];
    const refresh = vi.fn(
      () =>
        new Promise<undefined>((resolve) => {
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          release.push(() => {
            active -= 1;
            resolve(undefined);
          });
        })
    );
    const refreshing = refreshHistoryDetails(pending, { refresh } as never);
    await Promise.resolve();
    expect(refresh).toHaveBeenCalledTimes(HISTORY_REFRESH_CONCURRENCY);
    while (refresh.mock.calls.length < pending.length) {
      while (release.length) release.shift()!();
      await Promise.resolve();
    }
    while (release.length) release.shift()!();
    await refreshing;
    expect(maximumActive).toBe(HISTORY_REFRESH_CONCURRENCY);
  });

  it('reseeds from monotonic parent remote updates, then fetches once per stable remote key', async () => {
    const sync = {
      refresh: vi.fn().mockResolvedValue({ id: 'remote-1', status: 'received' }),
      sync: vi.fn(),
      delete: vi.fn(),
      syncPending: vi.fn()
    };
    const local = { ...session, state: 'processed' as const };
    mocks.recorder.get.mockResolvedValue(local);
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<ActivityDetail session={local} sync={sync as never} onExit={vi.fn()} />);
    });
    expect(sync.refresh).not.toHaveBeenCalled();

    const reconciled = { ...local, remoteId: 'remote-1', remoteStatus: 'received' as const };
    mocks.recorder.get.mockResolvedValue(reconciled);
    await act(async () => {
      renderer.update(
        <ActivityDetail session={reconciled} sync={sync as never} onExit={vi.fn()} />
      );
    });
    expect(sync.refresh).toHaveBeenCalledTimes(1);
    expect(sync.refresh).toHaveBeenLastCalledWith(
      expect.objectContaining({ remoteId: 'remote-1' })
    );

    await act(async () => {
      renderer.update(
        <ActivityDetail
          session={{ ...reconciled, remoteStatus: 'derived' }}
          sync={sync as never}
          onExit={vi.fn()}
        />
      );
    });
    expect(sync.refresh).toHaveBeenCalledTimes(2);
    expect(text(renderer)).toContain('Activity pending.');
  });

  it('keeps a parent-learned remote ID when retrying a stale no-remote detail session', async () => {
    const parent = {
      ...session,
      state: 'queued' as const,
      remoteId: 'remote-1',
      remoteStatus: 'received' as const
    };
    const stale = { ...session, state: 'queued' as const };
    expect(reseedActivityDetailSession(stale, parent)).toMatchObject({
      remoteId: 'remote-1',
      remoteStatus: 'received'
    });
  });
});
