import { describe, expect, it, vi } from 'vitest';
import type { ActivitySession } from './activity-recorder-core.js';
import { createActivitySyncCoordinator, samplesToChunks } from './activity-sync.js';

const session: ActivitySession = {
  id: 'local-1',
  accountId: 'account-1',
  movementType: 'walk',
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
  setRemoteStatus: vi.fn(
    async (_id: string, _account: string, status: ActivitySession['remoteStatus']) => {
      stored.remoteStatus = status;
    }
  ),
  applyRemoteStatus: vi.fn(
    async (_session: ActivitySession, status: ActivitySession['remoteStatus']) => {
      stored.remoteStatus = status;
      if (status === 'derived') stored.state = 'processed';
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
