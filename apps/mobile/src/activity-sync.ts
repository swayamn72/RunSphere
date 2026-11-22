import type { ActivityRecorder, ActivitySession, LocationSample } from './activity-recorder-core';
import {
  ApiFailure,
  type ActivityChunk,
  type ActivityDetail,
  type ActivityStatus,
  type MobileApiClient
} from './api-client';
import { AuthFailure } from './auth-failure';
import { runStartFallback } from './run-start';
import { isKnownRemoteStatus, type SyncActivityStatus } from './screens/activity-results-model';

export const SYNC_CHUNK_SIZE = 250;
/**
 * `withAltitude` only for runs recorded from recorder schema 11 (see
 * `ActivitySession.uploadsAltitude`): the chunks of an older run must stay byte
 * for byte what they were, or a part-done upload can never finalize.
 */
export const samplesToChunks = (
  samples: readonly LocationSample[],
  withAltitude = false
): ActivityChunk[] => {
  const chunks: ActivityChunk[] = [];
  for (let index = 0; index < samples.length; index += SYNC_CHUNK_SIZE)
    chunks.push({
      sequence: chunks.length,
      points: samples
        .slice(index, index + SYNC_CHUNK_SIZE)
        .map(({ latitude, longitude, recordedAt, accuracy, altitude }) => ({
          latitude,
          longitude,
          recordedAt,
          ...(accuracy === null ? {} : { accuracyMeters: accuracy }),
          ...(withAltitude && altitude !== null && altitude >= -1_000 && altitude <= 10_000
            ? { altitudeMeters: altitude }
            : {})
        }))
    });
  return chunks;
};

export interface SyncResult {
  session: ActivitySession;
  status?: ActivityStatus;
}

const isTerminalStatus = (status: SyncActivityStatus): boolean =>
  status === 'derived' || status === 'rejected' || status === 'deleted';

export const SYNC_PENDING_CONCURRENCY = 3;

const synchronizeBounded = async <T>(
  items: readonly T[],
  work: (item: T) => Promise<SyncResult>
) => {
  const results: SyncResult[] = Array(items.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      const item = items[index];
      if (item) results[index] = await work(item);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(SYNC_PENDING_CONCURRENCY, items.length) }, worker)
  );
  return results;
};

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

/**
 * Whether a failed create was the server refusing the run's mode, rather than
 * the network, an expired session or an outage, which are retried as always.
 * The create route answers a refused mode with 400, 403 or 404 and a missing
 * sign-in with 401, so a 403 here is a refusal even though the client reports
 * every 403 as an `AuthFailure`.
 */
export const isRunModeRefusal = (error: unknown): boolean => {
  const status =
    error instanceof ApiFailure || error instanceof AuthFailure ? error.status : undefined;
  return status === 400 || status === 403 || status === 404;
};

/**
 * Create the server's record of a run, in the mode it started with if the
 * server still accepts it, or else in its fallback mode (`runStartFallback`
 * explains when that happens). The fallback is saved locally first, so the
 * phone and the server agree on what the run was, and a retry after a lost
 * response replays the same body under the same idempotency key.
 */
const createRemote = async (
  api: MobileApiClient,
  recorder: ActivityRecorder,
  session: ActivitySession
): Promise<ActivityStatus> => {
  const create = (start: ActivitySession['runStart']) =>
    api.createActivity(
      session.movementType,
      session.id,
      session.verification,
      session.startedAt,
      ...(start ? [start] : [])
    );
  try {
    return await create(session.runStart);
  } catch (error) {
    const fallback = session.runStart && runStartFallback(session.runStart);
    if (!fallback || !isRunModeRefusal(error)) throw error;
    await recorder.setRunStart(session.id, session.accountId, fallback.start, fallback.refused);
    return create(fallback.start);
  }
};

export const createActivitySyncCoordinator = (
  api: MobileApiClient,
  recorder: ActivityRecorder
) => ({
  async sync(session: ActivitySession): Promise<SyncResult> {
    if (!['queued', 'failed', 'syncing'].includes(session.state)) return { session };
    if (['rejected', 'deleted', 'derived'].includes(session.remoteStatus ?? '')) return { session };
    const now = new Date().toISOString();
    // A failed run goes back in the queue first: the recorder allows
    // failed -> queued -> syncing, not failed -> syncing. Going straight there
    // threw, so a phone with one failed upload could never retry it, and the
    // whole history refresh reported itself offline (found on a phone, M9 9.29).
    if (session.state === 'failed')
      await recorder.transition(session.id, session.accountId, 'failed', 'queued', now);
    if (session.state !== 'syncing')
      await recorder.transition(session.id, session.accountId, 'queued', 'syncing', now);
    try {
      const chunks = samplesToChunks(
        await recorder.samples(session.id, session.accountId),
        session.uploadsAltitude === true
      );
      if (!chunks.length) throw new Error('No recorded samples are available to upload.');
      let remoteId = session.remoteId;
      if (!remoteId) {
        // The verification was taken at the start of the run, which on an
        // offline-first client may have been days before this upload. It
        // travels with `startedAt` so the server can check it against the run
        // it belongs to rather than against the moment it happened to arrive.
        const created = await createRemote(api, recorder, session);
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
      await settleRemoteStatus(recorder, session, finalized.status, 'syncing');
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
    const pending = (await recorder.list(accountId)).filter(
      (item) =>
        ['queued', 'failed', 'syncing'].includes(item.state) &&
        !['rejected', 'deleted', 'derived'].includes(item.remoteStatus ?? '')
    );
    return synchronizeBounded(pending, (item) => this.sync(item));
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
