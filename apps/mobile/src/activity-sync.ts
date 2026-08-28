import type { ActivityRecorder, ActivitySession, LocationSample } from './activity-recorder-core';
import type { ActivityChunk, ActivityDetail, ActivityStatus, MobileApiClient } from './api-client';
import { isKnownRemoteStatus, type SyncActivityStatus } from './screens/activity-results-model';

export const SYNC_CHUNK_SIZE = 250;
export const samplesToChunks = (samples: readonly LocationSample[]): ActivityChunk[] => {
  const chunks: ActivityChunk[] = [];
  for (let index = 0; index < samples.length; index += SYNC_CHUNK_SIZE)
    chunks.push({
      sequence: chunks.length,
      points: samples
        .slice(index, index + SYNC_CHUNK_SIZE)
        .map(({ latitude, longitude, recordedAt, accuracy }) => ({
          latitude,
          longitude,
          recordedAt,
          ...(accuracy === null ? {} : { accuracyMeters: accuracy })
        }))
    });
  return chunks;
};

export interface SyncResult {
  session: ActivitySession;
  status?: ActivityStatus;
}

const isTerminalStatus = (status: SyncActivityStatus): boolean =>
  status === 'derived' || status === 'rejected';

const settleRemoteStatus = async (
  recorder: ActivityRecorder,
  session: ActivitySession,
  status: SyncActivityStatus,
  from: ActivitySession['state']
): Promise<void> => {
  await recorder.setRemoteStatus(session.id, session.accountId, status);
  const target = isTerminalStatus(status) ? 'processed' : 'queued';
  if (from === 'syncing')
    await recorder.transition(
      session.id,
      session.accountId,
      from,
      target,
      new Date().toISOString()
    );
};

export const createActivitySyncCoordinator = (
  api: MobileApiClient,
  recorder: ActivityRecorder
) => ({
  async sync(session: ActivitySession): Promise<SyncResult> {
    if (!['queued', 'failed', 'syncing'].includes(session.state)) return { session };
    if (session.remoteStatus === 'rejected' || session.remoteStatus === 'deleted')
      return { session };
    const now = new Date().toISOString();
    if (session.state !== 'syncing')
      await recorder.transition(session.id, session.accountId, session.state, 'syncing', now);
    try {
      const chunks = samplesToChunks(await recorder.samples(session.id, session.accountId));
      if (!chunks.length) throw new Error('No recorded samples are available to upload.');
      let remoteId = session.remoteId;
      if (!remoteId) {
        const created = await api.createActivity(session.movementType, session.id);
        remoteId = created.id;
        await recorder.setRemote(session.id, session.accountId, remoteId, created.status);
      }
      const remote = await api.recoverActivitySync(remoteId, chunks.length);
      if (!isKnownRemoteStatus(remote.status)) {
        await recorder.transition(
          session.id,
          session.accountId,
          'syncing',
          'queued',
          new Date().toISOString()
        );
        return { session: (await recorder.get(session.id, session.accountId))!, status: remote };
      }
      if (remote.status === 'deleted') {
        await recorder.setRemoteStatus(session.id, session.accountId, remote.status);
        return { session: (await recorder.get(session.id, session.accountId))!, status: remote };
      }
      if (remote.status !== 'received') {
        await settleRemoteStatus(recorder, session, remote.status, 'syncing');
        return { session: (await recorder.get(session.id, session.accountId))!, status: remote };
      }
      await recorder.setRemoteStatus(session.id, session.accountId, remote.status);
      const pending = (remote.missingSequences ?? []).filter(
        (sequence) => Number.isInteger(sequence) && sequence >= 0 && sequence < chunks.length
      );
      for (const sequence of pending) await api.uploadActivityChunk(remoteId, chunks[sequence]!);
      const finalized = await api.finalizeActivity(remoteId, chunks);
      if (!isKnownRemoteStatus(finalized.status)) {
        await recorder.transition(
          session.id,
          session.accountId,
          'syncing',
          'queued',
          new Date().toISOString()
        );
        return { session: (await recorder.get(session.id, session.accountId))!, status: finalized };
      }
      if (finalized.status === 'deleted') {
        await recorder.setRemoteStatus(session.id, session.accountId, finalized.status);
      } else {
        await settleRemoteStatus(recorder, session, finalized.status, 'syncing');
      }
      return { session: (await recorder.get(session.id, session.accountId))!, status: finalized };
    } catch (error) {
      await recorder.markSyncFailure(
        session.id,
        session.accountId,
        new Date().toISOString(),
        error instanceof Error ? error.message : 'Activity sync failed.'
      );
      return { session: (await recorder.get(session.id, session.accountId))! };
    }
  },
  async syncPending(accountId: string): Promise<SyncResult[]> {
    return Promise.all(
      (await recorder.list(accountId))
        .filter(
          (item) =>
            ['queued', 'failed', 'syncing'].includes(item.state) &&
            item.remoteStatus !== 'rejected' &&
            item.remoteStatus !== 'deleted'
        )
        .map((item) => this.sync(item))
    );
  },
  async delete(session: ActivitySession): Promise<void> {
    if (session.remoteId) await api.deleteActivity(session.remoteId);
    await recorder.remove(session.id, session.accountId);
  },
  async refresh(session: ActivitySession): Promise<ActivityDetail | undefined> {
    if (!session.remoteId) return undefined;
    const status = await api.activityStatus(session.remoteId);
    if (isKnownRemoteStatus(status.status))
      await recorder.applyRemoteStatus(session, status.status);
    return status;
  }
});
