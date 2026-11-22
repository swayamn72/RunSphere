import { describe, expect, it, vi } from 'vitest';
import type { ActivitySession } from './activity-recorder-core.js';
import { createActivitySyncCoordinator, samplesToChunks } from './activity-sync.js';
import { ApiFailure } from './api-client.js';
import { AuthFailure } from './auth-failure.js';

const session: ActivitySession = {
  id: 'local-1',
  accountId: 'account-1',
  movementType: 'run',
  state: 'queued',
  startedAt: '2026-08-28T06:00:00Z',
  updatedAt: '2026-08-28T06:01:00Z',
  completedAt: '2026-08-28T06:01:00Z',
  durationSeconds: 60,
  distanceMeters: 100,
  acceptedSamples: 2,
  lastHeartbeatAt: '2026-08-28T06:01:00Z'
};
const samples = [
  {
    recordedAt: '2026-08-28T06:00:00Z',
    latitude: 19.076,
    longitude: 72.877,
    accuracy: 8,
    altitude: null
  },
  {
    recordedAt: '2026-08-28T06:00:05Z',
    latitude: 19.0761,
    longitude: 72.8771,
    accuracy: 8,
    altitude: null
  }
];

const recorder = (stored: ActivitySession) => ({
  samples: vi.fn().mockResolvedValue(samples),
  transition: vi.fn(async (_id: string, _account: string, from: string, to: string) => {
    if (stored.state !== from) return false;
    stored.state = to as ActivitySession['state'];
    return true;
  }),
  setRemote: vi.fn(
    async (
      _id: string,
      _account: string,
      remoteId: string,
      remoteStatus?: ActivitySession['remoteStatus']
    ) => {
      stored.remoteId = remoteId;
      stored.remoteStatus = remoteStatus;
    }
  ),
  setRunStart: vi.fn(async (_id: string, _account: string, start: ActivitySession['runStart']) => {
    stored.runStart = start;
  }),
  setRemoteStatus: vi.fn(
    async (_id: string, _account: string, status: ActivitySession['remoteStatus']) => {
      stored.remoteStatus = status;
    }
  ),
  applyRemoteStatus: vi.fn(
    async (_session: ActivitySession, status: ActivitySession['remoteStatus']) => {
      stored.remoteStatus = status;
      if (['derived', 'rejected', 'deleted'].includes(status ?? '')) stored.state = 'processed';
      return stored;
    }
  ),
  get: vi.fn(async () => stored),
  markSyncFailure: vi.fn(async () => {
    stored.state = 'failed';
  }),
  list: vi.fn()
});

describe('activity sync coordinator', () => {
  it('persists received/validating lifecycle metadata while uploading canonical chunks', async () => {
    const stored = { ...session };
    const api = {
      createActivity: vi.fn().mockResolvedValue({ id: 'remote-1', status: 'received' }),
      recoverActivitySync: vi
        .fn()
        .mockResolvedValue({ id: 'remote-1', status: 'received', missingSequences: [0] }),
      uploadActivityChunk: vi.fn(),
      finalizeActivity: vi.fn().mockResolvedValue({ id: 'remote-1', status: 'validating' })
    };
    const local = recorder(stored);
    const result = await createActivitySyncCoordinator(api as never, local as never).sync(session);

    expect(api.recoverActivitySync).toHaveBeenCalledWith('remote-1', 1);
    expect(api.uploadActivityChunk).toHaveBeenCalledWith('remote-1', samplesToChunks(samples)[0]);
    expect(api.finalizeActivity).toHaveBeenCalledWith('remote-1', samplesToChunks(samples));
    expect(local.setRemoteStatus).toHaveBeenLastCalledWith('local-1', 'account-1', 'validating');
    expect(result.session).toMatchObject({ state: 'queued', remoteStatus: 'validating' });
  });

  it('sends the verification taken at the start of the run, with the start it belongs to', async () => {
    const verification = {
      method: 'biometric' as const,
      verifiedAt: '2026-08-28T05:59:50Z',
      deviceId: '7f1d0a9e-0000-4000-8000-000000000001'
    };
    const verified = { ...session, verification };
    const api = {
      createActivity: vi.fn().mockResolvedValue({ id: 'remote-1', status: 'received' }),
      recoverActivitySync: vi
        .fn()
        .mockResolvedValue({ id: 'remote-1', status: 'received', missingSequences: [] }),
      uploadActivityChunk: vi.fn(),
      finalizeActivity: vi.fn().mockResolvedValue({ id: 'remote-1', status: 'validating' })
    };
    await createActivitySyncCoordinator(api as never, recorder({ ...verified }) as never).sync(
      verified
    );

    // `startedAt` travels alongside: an offline-first upload may arrive days
    // later, so the server has to check the verification against the run
    // rather than against its own clock.
    expect(api.createActivity).toHaveBeenCalledWith(
      'run',
      'local-1',
      verification,
      session.startedAt
    );
  });

  it('uploads a run recorded before the gate shipped rather than holding it back', async () => {
    const api = {
      createActivity: vi.fn().mockResolvedValue({ id: 'remote-1', status: 'received' }),
      recoverActivitySync: vi
        .fn()
        .mockResolvedValue({ id: 'remote-1', status: 'received', missingSequences: [] }),
      uploadActivityChunk: vi.fn(),
      finalizeActivity: vi.fn().mockResolvedValue({ id: 'remote-1', status: 'validating' })
    };
    await createActivitySyncCoordinator(api as never, recorder({ ...session }) as never).sync(
      session
    );

    expect(api.createActivity).toHaveBeenCalledWith('run', 'local-1', undefined, session.startedAt);
  });

  describe('run modes (M9 9.5)', () => {
    const uploading = () => ({
      recoverActivitySync: vi
        .fn()
        .mockResolvedValue({ id: 'remote-1', status: 'received', missingSequences: [] }),
      uploadActivityChunk: vi.fn(),
      finalizeActivity: vi.fn().mockResolvedValue({ id: 'remote-1', status: 'validating' })
    });

    it('sends the mode the run was started as', async () => {
      const quest = { ...session, runStart: { mode: 'quest' as const, questId: 'quest-1' } };
      const api = {
        ...uploading(),
        createActivity: vi.fn().mockResolvedValue({ id: 'remote-1', status: 'received' })
      };
      await createActivitySyncCoordinator(api as never, recorder({ ...quest }) as never).sync(
        quest
      );
      expect(api.createActivity).toHaveBeenCalledWith(
        'run',
        'local-1',
        undefined,
        session.startedAt,
        { mode: 'quest', questId: 'quest-1' }
      );
    });

    it.each([
      ['a Ghost Race whose ground changed hands', new ApiFailure(404, 'gone'), 'ghost', 'turf'],
      [
        'a Ghost Race the holder closed',
        new AuthFailure('invalid-credentials', 403),
        'ghost',
        'turf'
      ],
      ['a quest no longer open', new ApiFailure(400, 'Take this quest on first'), 'quest', 'free']
    ] as const)('keeps %s as a %s run in its fallback mode', async (_case, failure, from, to) => {
      const start =
        from === 'ghost'
          ? ({ mode: 'ghost', ghostClaimId: 'claim-1' } as const)
          : ({ mode: 'quest', questId: 'quest-1' } as const);
      const stored = { ...session, runStart: start };
      const api = {
        ...uploading(),
        createActivity: vi
          .fn()
          .mockRejectedValueOnce(failure)
          .mockResolvedValueOnce({ id: 'remote-1', status: 'received' })
      };
      const local = recorder(stored);
      const result = await createActivitySyncCoordinator(api as never, local as never).sync({
        ...stored
      });

      expect(local.setRunStart).toHaveBeenCalledWith('local-1', 'account-1', { mode: to });
      expect(api.createActivity).toHaveBeenLastCalledWith(
        'run',
        'local-1',
        undefined,
        session.startedAt,
        { mode: to }
      );
      expect(result.session).toMatchObject({ remoteId: 'remote-1', runStart: { mode: to } });
    });

    it('retries a network failure in the same mode, never downgrading it', async () => {
      const ghost = { ...session, runStart: { mode: 'ghost' as const, ghostClaimId: 'claim-1' } };
      const api = {
        ...uploading(),
        createActivity: vi.fn().mockRejectedValue(new AuthFailure('network'))
      };
      const local = recorder({ ...ghost });
      const result = await createActivitySyncCoordinator(api as never, local as never).sync(ghost);
      expect(api.createActivity).toHaveBeenCalledTimes(1);
      expect(local.setRunStart).not.toHaveBeenCalled();
      expect(result.session.state).toBe('failed');
    });

    it('has nothing to fall back to for a refused Turf run', async () => {
      const turf = { ...session, runStart: { mode: 'turf' as const } };
      const api = {
        ...uploading(),
        createActivity: vi.fn().mockRejectedValue(new ApiFailure(400, 'bad'))
      };
      const local = recorder({ ...turf });
      await createActivitySyncCoordinator(api as never, local as never).sync(turf);
      expect(api.createActivity).toHaveBeenCalledTimes(1);
      expect(local.setRunStart).not.toHaveBeenCalled();
    });
  });

  it.each(['rejected', 'derived'] as const)(
    'settles terminal %s server status locally',
    async (status) => {
      const stored = { ...session };
      const api = {
        createActivity: vi.fn().mockResolvedValue({ id: 'remote-1', status: 'received' }),
        recoverActivitySync: vi.fn().mockResolvedValue({ id: 'remote-1', status }),
        uploadActivityChunk: vi.fn(),
        finalizeActivity: vi.fn()
      };
      const local = recorder(stored);
      const result = await createActivitySyncCoordinator(api as never, local as never).sync(
        session
      );

      expect(result.session).toMatchObject({ state: 'processed', remoteStatus: status });
      expect(api.uploadActivityChunk).not.toHaveBeenCalled();
    }
  );

  it('does not retry an already rejected local lifecycle result', async () => {
    const stored = { ...session, state: 'processed' as const, remoteStatus: 'rejected' as const };
    const api = { createActivity: vi.fn() };
    const local = recorder(stored);
    await expect(
      createActivitySyncCoordinator(api as never, local as never).sync(stored)
    ).resolves.toEqual({
      session: stored
    });
    expect(api.createActivity).not.toHaveBeenCalled();
  });

  it.each(['rejected', 'deleted', 'derived'] as const)(
    'does not create a duplicate remote activity for cached terminal %s status',
    async (remoteStatus) => {
      const stored = { ...session, remoteStatus };
      const api = { createActivity: vi.fn() };
      const local = recorder(stored);
      await createActivitySyncCoordinator(api as never, local as never).sync(stored);
      expect(api.createActivity).not.toHaveBeenCalled();
    }
  );

  it('persists fetched detail lifecycle status through the refresh/apply path', async () => {
    const stored = { ...session, remoteId: 'remote-1' };
    const api = {
      activityStatus: vi.fn().mockResolvedValue({
        id: 'remote-1',
        status: 'derived',
        summary: { distanceMeters: 100, durationSeconds: 60, pointCount: 2, privacyTrimmed: false },
        geometry: null
      })
    };
    const local = recorder(stored);
    const result = await createActivitySyncCoordinator(api as never, local as never).refresh(
      stored
    );

    expect(result?.status).toBe('derived');
    expect(local.applyRemoteStatus).toHaveBeenCalledWith(stored, 'derived');
    expect(stored).toMatchObject({ state: 'processed', remoteStatus: 'derived' });
  });

  it('settles deleted status and skips all terminal rows during bounded refresh', async () => {
    const deleted = { ...session, remoteId: 'remote-deleted' };
    const rejected = { ...session, id: 'rejected', remoteStatus: 'rejected' as const };
    const derived = { ...session, id: 'derived', remoteStatus: 'derived' as const };
    const stored = { ...deleted };
    const api = {
      activityStatus: vi.fn().mockResolvedValue({ id: 'remote-deleted', status: 'deleted' })
    };
    const local = recorder(stored);
    const coordinator = createActivitySyncCoordinator(api as never, local as never);

    await coordinator.refresh(deleted);
    expect(stored).toMatchObject({ state: 'processed', remoteStatus: 'deleted' });

    local.list.mockResolvedValue([rejected, derived]);
    await coordinator.syncPending('account-1');
    expect(local.samples).not.toHaveBeenCalled();
  });

  it('does not turn unknown future server statuses into a local failure', async () => {
    const stored = { ...session };
    const api = {
      createActivity: vi.fn().mockResolvedValue({ id: 'remote-1', status: 'received' }),
      recoverActivitySync: vi.fn().mockResolvedValue({ id: 'remote-1', status: 'future-status' }),
      uploadActivityChunk: vi.fn(),
      finalizeActivity: vi.fn()
    };
    const local = recorder(stored);
    const result = await createActivitySyncCoordinator(api as never, local as never).sync(session);

    expect(result.session.state).toBe('queued');
    expect(local.markSyncFailure).not.toHaveBeenCalled();
  });
});
