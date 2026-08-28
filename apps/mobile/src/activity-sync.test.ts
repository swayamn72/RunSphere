import { describe, expect, it, vi } from 'vitest';
import { createActivitySyncCoordinator, samplesToChunks } from './activity-sync.js';
import type { ActivitySession } from './activity-recorder-core.js';

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

describe('activity sync coordinator', () => {
  it('uploads only missing sequences, finalizes canonical chunks, and remains resumable', async () => {
    const stored = { ...session };
    const api = {
      createActivity: vi.fn().mockResolvedValue({ id: 'remote-1', status: 'received' }),
      recoverActivitySync: vi
        .fn()
        .mockResolvedValue({ id: 'remote-1', status: 'received', missingSequences: [0] }),
      uploadActivityChunk: vi.fn(),
      finalizeActivity: vi.fn().mockResolvedValue({ id: 'remote-1', status: 'validating' })
    };
    const recorder = {
      samples: vi.fn().mockResolvedValue(samples),
      transition: vi.fn(async (_id: string, _account: string, from: string, to: string) => {
        if (stored.state === from) {
          stored.state = to as typeof stored.state;
          return true;
        }
        return false;
      }),
      setRemote: vi.fn(async (_id: string, _account: string, remoteId: string) => {
        stored.remoteId = remoteId;
      }),
      get: vi.fn(async () => stored),
      markSyncFailure: vi.fn(),
      list: vi.fn()
    };
    const result = await createActivitySyncCoordinator(api as never, recorder as never).sync(
      session
    );
    expect(api.recoverActivitySync).toHaveBeenCalledWith('remote-1', 1);
    expect(api.uploadActivityChunk).toHaveBeenCalledOnce();
    expect(api.finalizeActivity).toHaveBeenCalledWith('remote-1', samplesToChunks(samples));
    expect(result.session.state).toBe('queued');
  });
  it('marks network failures and leaves activity available for retry', async () => {
    const recorder = {
      transition: vi.fn().mockResolvedValue(true),
      samples: vi.fn().mockResolvedValue(samples),
      setRemote: vi.fn(),
      get: vi.fn().mockResolvedValue({ ...session, state: 'failed' }),
      markSyncFailure: vi.fn(),
      list: vi.fn()
    };
    const api = {
      createActivity: vi.fn().mockRejectedValue(new TypeError('Network request failed'))
    };
    const result = await createActivitySyncCoordinator(api as never, recorder as never).sync(
      session
    );
    expect(recorder.markSyncFailure).toHaveBeenCalledOnce();
    expect(result.session.state).toBe('failed');
  });
});
