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
    PanResponder: { create: () => ({ panHandlers: {} }) },
    Pressable: native('Pressable'),
    Text: native('Text'),
    View: native('View')
  };
});
vi.mock('../activity-recorder.native', () => ({ activityRecorder: mocks.recorder }));
// `expo-local-authentication` reaches `expo-modules-core`, which touches
// `__DEV__` at import time and cannot load here. The gate's own decisions are
// covered in `run-verification.test.ts`; this file needs the seam to exist and
// to answer, not to be real. The default answer is a phone with no screen lock,
// which is the path that lets preparation proceed without a prompt.
vi.mock('../run-verification.native', () => ({
  deviceAuthenticator: {
    capability: vi.fn().mockResolvedValue({ hasHardware: true, securityLevel: 'none' }),
    authenticate: vi.fn().mockResolvedValue({ outcome: 'success' })
  },
  verificationDeviceStore: { deviceId: vi.fn().mockResolvedValue('test-device') }
}));
vi.mock('../location-adapter', () => ({
  recordingLocationAdapter: { subscribe: vi.fn().mockResolvedValue({ remove: vi.fn() }) },
  runRecordingLocationAdapter: { subscribe: vi.fn().mockResolvedValue({ remove: vi.fn() }) }
}));
vi.mock('../components/styles', () => ({ useAppStyles: () => new Proxy({}, { get: () => ({}) }) }));
// The live screen reads one token directly: the ghost comparison card takes a
// status colour that changes as the race does, so it cannot come from a
// stylesheet entry.
vi.mock('../theme/theme', () => ({
  useAppTheme: () => ({
    colorScheme: 'light',
    reduceMotion: true,
    tokens: {
      status: { success: '#075F52', warning: '#8A5A00', error: '#A83E2B', info: '#246D84' }
    }
  })
}));
// Guidance has its own render tests; this file is about lifecycle, and the
// callout would otherwise need the whole theme provider.
vi.mock('../components/LoopCallout', () => ({ LoopCallout: () => null }));
vi.mock('../components/primitives', async () => {
  const React = await import('react');
  return {
    PrimaryButton: ({ label, onPress }: { label: string; onPress: () => void }) =>
      React.createElement('PrimaryButton' as React.ElementType, { label, onPress }),
    Stat: () => null
  };
});
// The quest stop pins are MapLibre markers, which cannot load here.
vi.mock('./QuestStopMarkers', () => ({ QuestStopMarkers: () => null }));
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
  movementType: 'run',
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
    // Found by the name a screen reader announces, which stays stable when
    // the visible label changes.
    const finish = renderer.root
      .findAllByType('Pressable' as React.ElementType)
      .find((node) => node.props['accessibilityLabel'] === 'End run');
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
    expect(text(renderer)).toContain('Verifying Your Run...');
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

  it('shows the phone’s splits as Checking…, then the server’s once the run counts (M9 9.12)', async () => {
    // 1.2 km at 5:00/km, one fix a second. Synthetic, not a real place.
    mocks.recorder.liveSamples.mockResolvedValue(
      Array.from({ length: 361 }, (_, index) => ({
        recordedAt: new Date(Date.UTC(2026, 10, 22, 1, 0, index)).toISOString(),
        latitude: 1 + (index * (1_000 / 300)) / 111_195,
        longitude: 1,
        accuracy: 8,
        altitude: null,
        disposition: 'usable',
        segmentBreak: false
      }))
    );
    const pending = {
      ...session,
      state: 'queued' as const,
      remoteId: 'remote-1',
      remoteStatus: 'validating' as const
    };
    let resolveRefresh!: (value: unknown) => void;
    const detailSync = {
      sync: vi.fn(),
      refresh: vi.fn(() => new Promise((resolve) => (resolveRefresh = resolve))),
      delete: vi.fn(),
      syncPending: vi.fn()
    };
    mocks.recorder.get.mockResolvedValue(pending);
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <ActivityDetail session={pending} sync={detailSync as never} onExit={vi.fn()} />
      );
    });
    expect(text(renderer)).toContain('Checking…');
    expect(text(renderer)).toContain('Km 1 · Best');
    expect(text(renderer)).toContain('5:00 /km');

    await act(async () => {
      resolveRefresh({
        id: 'remote-1',
        status: 'derived',
        summary: {
          distanceMeters: 1_200,
          durationSeconds: 360,
          pointCount: 361,
          rejectedPointCount: 0,
          rejectedGapCount: 0,
          privacyTrimmed: false
        },
        metrics: {
          metricsVersion: 1,
          elapsedSeconds: 360,
          activeSeconds: 360,
          movingSeconds: 355,
          distanceMeters: 1_200,
          averagePaceSecondsPerKm: 300,
          movingPaceSecondsPerKm: 295.8,
          splits: [
            {
              km: 1,
              distanceMeters: 1_000,
              movingSeconds: 292,
              paceSecondsPerKm: 292,
              elevationChangeMeters: null,
              partial: false
            },
            {
              km: 2,
              distanceMeters: 200,
              movingSeconds: 63,
              paceSecondsPerKm: 315,
              elevationChangeMeters: null,
              partial: true
            }
          ],
          fastestSplitKm: 1,
          bestEfforts: [],
          elevation: null,
          paceSeries: [],
          elevationSeries: []
        }
      });
      await Promise.resolve();
    });
    expect(text(renderer)).toContain('Your run counts.');
    expect(text(renderer)).not.toContain('Checking…');
    expect(text(renderer)).toContain('4:52 /km');
    expect(text(renderer)).toContain('Last 0.20 km');
  });

  describe('each mode has its own HUD and result (M9 9.7)', () => {
    const sync = () => ({
      sync: vi.fn(),
      refresh: vi.fn(),
      delete: vi.fn(),
      syncPending: vi.fn()
    });
    const ghost = {
      claimId: 'claim-1',
      holderName: 'Ravi',
      trace: {
        points: [
          { latitude: 19.076, longitude: 72.8777, elapsedSeconds: 0, distanceMetres: 0 },
          { latitude: 19.077, longitude: 72.8777, elapsedSeconds: 600, distanceMetres: 110 }
        ],
        durationSeconds: 600,
        distanceMetres: 110
      },
      privacyNote: '',
      rulesNote: ''
    };
    const renderLive = async (
      runStart: ActivitySession['runStart'],
      extra: Record<string, unknown> = {}
    ) => {
      const live = { ...session, ...(runStart ? { runStart } : {}) };
      mocks.recorder.get.mockResolvedValue(live);
      let renderer!: ReactTestRenderer;
      await act(async () => {
        renderer = create(
          <ActivityRecording
            session={live}
            accountId={session.accountId}
            onChange={vi.fn()}
            onExit={vi.fn()}
            sync={sync() as never}
            {...extra}
          />
        );
      });
      return renderer;
    };

    it('shows a Free run as stats only, even when a ghost is handed in', async () => {
      const renderer = await renderLive({ mode: 'free' }, { ghost });
      expect(text(renderer)).toContain('FREE RUN');
      expect(text(renderer)).toContain('Distance');
      expect(text(renderer)).not.toContain('Ravi');
      expect(text(renderer)).not.toMatch(/stops passed/);
    });

    it('shows the ghost card only on a Ghost Race', async () => {
      const renderer = await renderLive({ mode: 'ghost', ghostClaimId: 'claim-1' }, { ghost });
      expect(text(renderer)).toContain('GHOST RACE');
      expect(text(renderer)).toContain('Ravi');
    });

    it('lists a Quest run’s stops, ticking off the ones passed', async () => {
      mocks.recorder.liveSamples.mockResolvedValue([
        {
          recordedAt: '2026-08-28T06:00:30Z',
          latitude: 19.076,
          longitude: 72.8777,
          accuracy: 8,
          altitude: null,
          disposition: 'usable',
          segmentBreak: false
        }
      ]);
      const quest = {
        checkpoints: [
          {
            id: 'a',
            kind: 'place',
            title: 'Gate',
            geometry: { type: 'Point', coordinates: [72.8777, 19.076] }
          },
          {
            id: 'b',
            kind: 'place',
            title: 'Pier',
            geometry: { type: 'Point', coordinates: [72.9, 19.1] }
          }
        ]
      };
      const renderer = await renderLive({ mode: 'quest', questId: 'quest-1' }, { quest });
      expect(text(renderer)).toContain('QUEST RUN');
      expect(text(renderer)).toContain('1 of 2 stops passed · any order');
      expect(text(renderer)).toContain('✓ Gate');
      expect(text(renderer)).toContain('○ Pier');

      // Dragged or tapped down, the panel keeps the numbers and hides the rest.
      const handle = renderer.root
        .findAllByType('Pressable' as React.ElementType)
        .find((node) => node.props['accessibilityLabel'] === 'Hide run details')!;
      await act(async () => handle.props.onPress());
      expect(text(renderer)).not.toContain('○ Pier');
      expect(text(renderer)).not.toContain('End run');
      expect(text(renderer)).toContain('Distance');
      const show = renderer.root
        .findAllByType('Pressable' as React.ElementType)
        .find((node) => node.props['accessibilityLabel'] === 'Show run details')!;
      await act(async () => show.props.onPress());
      expect(text(renderer)).toContain('End run');
    });

    it.each([
      [{ mode: 'free' as const }, 'Run done'],
      [{ mode: 'quest' as const, questId: 'q' }, 'Quest run done'],
      [{ mode: 'ghost' as const, ghostClaimId: 'c' }, 'Race done'],
      [undefined, 'New ground covered']
    ])('finishes a %o run on its own result', async (runStart, title) => {
      mocks.recorder.get.mockResolvedValue({
        ...session,
        ...(runStart ? { runStart } : {}),
        state: 'completed-local'
      });
      let finished!: ReactTestRenderer;
      await act(async () => {
        finished = create(
          <ActivityRecording
            session={{ ...session, ...(runStart ? { runStart } : {}), state: 'completed-local' }}
            accountId={session.accountId}
            onChange={vi.fn()}
            onExit={vi.fn()}
            sync={sync() as never}
          />
        );
      });
      expect(text(finished)).toContain(title);
    });

    const counted = async (session2: ActivitySession, onOpenMap?: () => void) => {
      const detailSync = sync();
      detailSync.refresh.mockResolvedValue({
        id: 'remote-1',
        status: 'derived',
        summary: { distanceMeters: 1200, durationSeconds: 600, privacyTrimmed: true }
      });
      mocks.recorder.get.mockResolvedValue(session2);
      let renderer!: ReactTestRenderer;
      await act(async () => {
        renderer = create(
          <ActivityDetail
            session={session2}
            sync={detailSync as never}
            onExit={vi.fn()}
            {...(onOpenMap ? { onOpenMap } : {})}
          />
        );
      });
      await act(async () => {
        await Promise.resolve();
      });
      return renderer;
    };
    const claimButton = (renderer: ReactTestRenderer) =>
      renderer.root
        .findAllByType('PrimaryButton' as React.ElementType)
        .find((node) => node.props['label'] === 'Claim it on the Map');

    it('offers to claim a counted Turf run on the Map, but not a counted Free run', async () => {
      const base = {
        ...session,
        state: 'processed' as const,
        remoteId: 'remote-1',
        remoteStatus: 'derived' as const
      };
      const onOpenMap = vi.fn();
      const turf = await counted({ ...base, runStart: { mode: 'turf' } }, onOpenMap);
      expect(text(turf)).toContain('Your run counts.');
      claimButton(turf)!.props.onPress();
      expect(onOpenMap).toHaveBeenCalled();
      const free = await counted({ ...base, runStart: { mode: 'free' } }, onOpenMap);
      expect(text(free)).toContain('Your run counts.');
      expect(claimButton(free)).toBeUndefined();
    });

    it('says when a Ghost Race was kept as a Turf run', async () => {
      const renderer = await counted({
        ...session,
        state: 'processed',
        remoteId: 'remote-1',
        remoteStatus: 'derived',
        runStart: { mode: 'turf' },
        refusedRunMode: 'ghost'
      });
      expect(text(renderer)).toContain('counts as a Turf run');
    });
  });
});
