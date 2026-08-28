import * as Location from 'expo-location';
import { useEffect, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { activityRecorder } from '../activity-recorder.native';
import {
  isWeakGpsSample,
  type ActivitySession,
  type MovementType,
  type RecordingState
} from '../activity-recorder-core';
import { recordingLocationAdapter } from '../location-adapter';
import { type createActivitySyncCoordinator } from '../activity-sync';
import type { ActivityStatus } from '../api-client';
import { PrimaryButton, Stat } from '../components/primitives';
import { styles } from '../components/styles';

export function ActivityPreparation({
  accountId,
  initialMovement,
  onChange
}: {
  accountId: string;
  initialMovement: MovementType;
  onChange: (session: ActivitySession) => void;
}) {
  const [movement, setMovement] = useState<MovementType>(initialMovement);
  const [busy, setBusy] = useState(false);
  const [backgroundOptIn, setBackgroundOptIn] = useState(false);
  const begin = async () => {
    setBusy(true);
    try {
      const foreground = await Location.requestForegroundPermissionsAsync();
      if (!foreground.granted) {
        Alert.alert('Location needed', 'Allow precise location to record an activity.');
        return;
      }
      let backgroundGranted = false;
      if (backgroundOptIn) {
        const background = await recordingLocationAdapter.requestBackgroundPermission();
        backgroundGranted = background.granted;
        if (!backgroundGranted)
          Alert.alert(
            'Screen-lock recording unavailable',
            'Recording will stay active while RunSphere remains open.'
          );
      }
      const now = new Date().toISOString();
      const id = `activity-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await activityRecorder.create({
        id,
        accountId,
        movementType: movement,
        state: 'prepare',
        startedAt: now,
        updatedAt: now,
        lastHeartbeatAt: now
      });
      await activityRecorder.transition(id, accountId, 'prepare', 'acquiring', now);
      if (backgroundGranted) await recordingLocationAdapter.startBackground();
      await activityRecorder.transition(
        id,
        accountId,
        'acquiring',
        'active',
        new Date().toISOString()
      );
      const session = await activityRecorder.get(id, accountId);
      if (session) onChange(session);
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={styles.recordCard}>
      <Text style={styles.eyebrow}>START AN ACTIVITY</Text>
      <Text style={styles.recordTitle}>Move at your own pace.</Text>
      <Text style={styles.lead}>
        Foreground recording works while RunSphere is open. Screen-lock recording is an optional,
        separate permission.
      </Text>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: backgroundOptIn }}
        onPress={() => setBackgroundOptIn((value) => !value)}
        style={styles.checkRow}
      >
        <View style={[styles.checkbox, backgroundOptIn && styles.checkboxChecked]}>
          {backgroundOptIn && <Text style={styles.checkMark}>✓</Text>}
        </View>
        <Text style={styles.checkCopy}>Keep recording when the screen locks</Text>
      </Pressable>
      <View style={styles.choiceGrid}>
        {(['walk', 'run', 'hike'] as MovementType[]).map((type) => (
          <Pressable
            key={type}
            accessibilityRole="radio"
            accessibilityState={{ selected: movement === type }}
            onPress={() => setMovement(type)}
            style={[styles.choice, movement === type && styles.choiceSelected]}
          >
            <Text style={styles.choiceTitle}>{type.charAt(0).toUpperCase() + type.slice(1)}</Text>
          </Pressable>
        ))}
      </View>
      <PrimaryButton
        label={busy ? 'Preparing…' : 'Start recording'}
        disabled={busy}
        onPress={() => void begin()}
      />
    </View>
  );
}

export function ActivityRecording({
  session,
  accountId,
  onChange,
  sync
}: {
  session: ActivitySession;
  accountId: string;
  onChange: (session: ActivitySession | undefined) => void;
  sync: ReturnType<typeof createActivitySyncCoordinator>;
}) {
  const [current, setCurrent] = useState(session);
  const [gpsWeak, setGpsWeak] = useState(false);
  useEffect(() => {
    let subscription: Location.LocationSubscription | undefined;
    let cancelled = false;
    if (['active', 'resumed'].includes(current.state)) {
      void recordingLocationAdapter
        .subscribe(async (sample) => {
          const accepted = await activityRecorder.appendSample(current.id, accountId, sample);
          if (cancelled) return;
          setGpsWeak(isWeakGpsSample(sample));
          if (!accepted) return;
          const fresh = await activityRecorder.get(current.id, accountId);
          if (fresh && !cancelled) setCurrent(fresh);
        })
        .then((next) => {
          if (cancelled) next.remove();
          else subscription = next;
        })
        .catch((error) => {
          if (!cancelled) console.warn('Unable to start activity location watcher', error);
        });
    }
    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [accountId, current.id, current.state]);
  useEffect(() => {
    if (!['active', 'resumed'].includes(current.state)) return;
    const { id } = current;
    const interval = setInterval(() => {
      void activityRecorder
        .heartbeat(id, accountId, new Date().toISOString())
        .then(async () => {
          const fresh = await activityRecorder.get(id, accountId);
          if (fresh) setCurrent(fresh);
        });
    }, 15_000);
    return () => clearInterval(interval);
  }, [accountId, current.id, current.state]);
  const transition = async (to: RecordingState) => {
    const from = current.state;
    const at = new Date().toISOString();
    await activityRecorder.transition(current.id, accountId, from, to, at);
    const fresh = await activityRecorder.get(current.id, accountId);
    if (fresh) {
      setCurrent(fresh);
      onChange(fresh);
    }
  };
  const finish = async () => {
    const at = new Date().toISOString();
    await activityRecorder.heartbeat(current.id, accountId, at);
    await activityRecorder.transition(current.id, accountId, current.state, 'finishing', at);
    await activityRecorder.transition(
      current.id,
      accountId,
      'finishing',
      'completed-local',
      new Date().toISOString()
    );
    await recordingLocationAdapter.stopBackground();
    const fresh = await activityRecorder.get(current.id, accountId);
    if (fresh) {
      setCurrent(fresh);
      onChange(fresh);
    }
  };
  const duration = formatDuration(current.durationSeconds);
  const pace =
    current.distanceMeters > 0
      ? formatDuration(Math.round(current.durationSeconds / (current.distanceMeters / 1000)))
      : '—';
  if (current.state === 'completed-local')
    return (
      <ActivityResults
        session={current}
        onQueue={async () => {
          await transition('queued');
          const refreshed = await activityRecorder.get(current.id, accountId);
          if (refreshed) {
            const result = await sync.sync(refreshed);
            setCurrent(result.session);
            onChange(result.session);
          }
        }}
        onDiscard={async () => {
          await transition('discarded');
          onChange(undefined);
        }}
      />
    );
  if (['queued', 'failed', 'processed'].includes(current.state))
    return <ActivityDetail session={current} sync={sync} onChange={onChange} />;
  if (gpsWeak)
    return (
      <GpsRecovery onRetry={() => setGpsWeak(false)} onPause={() => void transition('paused')} />
    );
  const paused = current.state === 'paused';
  return (
    <View style={styles.liveCard}>
      <View style={styles.liveTop}>
        <Text style={styles.eyebrow}>
          {current.movementType.toUpperCase()} · {duration}
        </Text>
        <Text style={styles.gpsStrong}>● GPS strong</Text>
      </View>
      <Text style={styles.liveDistance}>
        {(current.distanceMeters / 1000).toFixed(2)} <Text style={styles.unit}>km</Text>
      </Text>
      <Text style={styles.provisional}>PROVISIONAL DISTANCE · accuracy-filtered</Text>
      <View style={styles.liveStats}>
        <Stat label="AVG PACE /KM" value={pace} detail="Provisional" />
        <Stat label="SAMPLES" value={`${current.acceptedSamples}`} detail="Accepted GPS points" />
      </View>
      <PrimaryButton
        label={paused ? 'Resume activity' : 'Pause activity'}
        onPress={() => void transition(paused ? 'resumed' : 'paused')}
      />
      <Pressable accessibilityRole="button" onPress={() => void finish()}>
        <Text style={styles.textButton}>Finish activity</Text>
      </Pressable>
    </View>
  );
}

function ActivityDetail({
  session,
  sync,
  onChange
}: {
  session: ActivitySession;
  sync: ReturnType<typeof createActivitySyncCoordinator>;
  onChange: (session: ActivitySession | undefined) => void;
}) {
  const [current, setCurrent] = useState(session);
  const [remote, setRemote] = useState<ActivityStatus>();
  const isProcessed = current.state === 'processed';
  const retry = async () => {
    const next = await sync.sync(current);
    setCurrent(next.session);
    setRemote(next.status);
  };
  useEffect(() => {
    void sync
      .refresh(session)
      .then((status) => status && setRemote(status))
      .catch(() => undefined);
  }, [session, sync]);
  const remove = async () => {
    await sync.delete(current);
    onChange(undefined);
  };
  return (
    <View style={styles.recordCard}>
      <Text style={styles.eyebrow}>
        {isProcessed
          ? 'ACTIVITY PROCESSED'
          : current.state === 'failed'
            ? 'SYNC NEEDS ATTENTION'
            : 'OFFLINE · SAVED ON THIS DEVICE'}
      </Text>
      <Text style={styles.recordTitle}>
        {isProcessed
          ? 'Activity ready.'
          : current.state === 'failed'
            ? 'Sync paused.'
            : 'Activity queued.'}
      </Text>
      <Text style={styles.lead}>
        {isProcessed
          ? 'Validation is complete. Your processed result stays private in your activity history.'
          : remote?.status === 'rejected'
            ? (remote.rejectionReason ?? 'This activity did not pass validation.')
            : (current.syncError ??
              'Your local result is safe and will resume when connectivity returns.')}
      </Text>
      <View style={styles.resultStats}>
        <Stat
          label="KM"
          value={((remote?.summary?.distanceMeters ?? current.distanceMeters) / 1000).toFixed(2)}
          detail={remote?.summary ? 'Validated' : 'Local'}
        />
        <Stat
          label="TIME"
          value={formatDuration(remote?.summary?.durationSeconds ?? current.durationSeconds)}
          detail={remote?.summary ? 'Validated' : 'Recorded'}
        />
        <Stat
          label="STATUS"
          value={(remote?.status ?? current.state).toUpperCase()}
          detail={remote?.summary?.privacyTrimmed ? '200 m zones applied' : 'Private'}
        />
      </View>
      {remote?.status === 'rejected' && remote.validationErrors?.length ? (
        <View style={[styles.notice, styles.warningNotice]} accessibilityLiveRegion="polite">
          <Text style={styles.noticeIcon}>!</Text>
          <View style={styles.flexCopy}>
            <Text style={styles.noticeTitle}>Validation needs attention</Text>
            <Text style={styles.noticeCopy}>{remote.validationErrors.join(' ')}</Text>
          </View>
        </View>
      ) : null}
      {isProcessed && (
        <View style={styles.notice} accessibilityLiveRegion="polite">
          <Text style={styles.noticeIcon}>✓</Text>
          <View style={styles.flexCopy}>
            <Text style={styles.noticeTitle}>Validation complete</Text>
            <Text style={styles.noticeCopy}>
              {remote?.summary?.privacyTrimmed
                ? 'Start, finish, and route fragments inside saved privacy zones were removed.'
                : 'No shareable map is created unless your privacy settings allow one.'}
            </Text>
          </View>
        </View>
      )}
      {!isProcessed && (
        <PrimaryButton
          label={current.state === 'failed' ? 'Retry sync' : 'Sync now'}
          onPress={() => void retry()}
        />
      )}
      <Pressable accessibilityRole="button" onPress={() => void remove()}>
        <Text style={[styles.textButton, styles.destructive]}>Delete activity</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={() => onChange(undefined)}>
        <Text style={styles.textButton}>Back to home</Text>
      </Pressable>
    </View>
  );
}

export function ActivityHistory({
  accountId,
  sync,
  onOpen
}: {
  accountId: string;
  sync: ReturnType<typeof createActivitySyncCoordinator>;
  onOpen: (session: ActivitySession) => void;
}) {
  const [items, setItems] = useState<ActivitySession[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const refresh = async () => {
    setLoading(true);
    setError(undefined);
    try {
      await sync.syncPending(accountId);
      const local = await activityRecorder.list(accountId);
      await Promise.all(local.map((item) => sync.refresh(item).catch(() => undefined)));
      setItems(await activityRecorder.list(accountId));
    } catch {
      setError('Your local history is still safe. Connect to refresh validation results.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void refresh();
  }, [accountId]);
  return (
    <View style={styles.history}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Activity history</Text>
        <Pressable accessibilityRole="button" onPress={() => void refresh()}>
          <Text style={styles.link}>{loading ? 'Refreshing…' : 'Refresh'}</Text>
        </Pressable>
      </View>
      {error && (
        <View style={[styles.notice, styles.warningNotice]} accessibilityLiveRegion="polite">
          <Text style={styles.noticeIcon}>!</Text>
          <View style={styles.flexCopy}>
            <Text style={styles.noticeTitle}>History is offline</Text>
            <Text style={styles.noticeCopy}>{error}</Text>
          </View>
        </View>
      )}
      {!loading && !items.length && !error && (
        <View style={styles.notice} accessibilityLiveRegion="polite">
          <Text style={styles.noticeIcon}>⌁</Text>
          <View style={styles.flexCopy}>
            <Text style={styles.noticeTitle}>No activities yet</Text>
            <Text style={styles.noticeCopy}>Your completed activities will appear here privately.</Text>
          </View>
        </View>
      )}
      {items.map((item) => (
        <Pressable
          key={item.id}
          accessibilityRole="button"
          onPress={() => onOpen(item)}
          style={styles.historyRow}
        >
          <View style={styles.flexCopy}>
            <Text style={styles.rowTitle}>
              {item.movementType.charAt(0).toUpperCase() + item.movementType.slice(1)} ·{' '}
              {(item.distanceMeters / 1000).toFixed(2)} km
            </Text>
            <Text style={styles.rowDetail}>
              {item.state === 'processed'
                ? 'Processed'
                : item.state === 'failed'
                  ? 'Sync failed — refresh to retry'
                  : item.state === 'queued'
                    ? 'Queued / processing'
                    : 'Local activity'}
            </Text>
          </View>
          <Text style={styles.link}>View ›</Text>
        </Pressable>
      ))}
    </View>
  );
}

function GpsRecovery({ onRetry, onPause }: { onRetry: () => void; onPause: () => void }) {
  return (
    <View style={styles.recordCard}>
      <Text style={styles.gpsError}>!</Text>
      <Text style={styles.recordTitle}>We can’t get a clear GPS signal</Text>
      <Text style={styles.lead}>Your activity is paused so distance stays accurate.</Text>
      <Text
        style={styles.recovery}
      >{`1  Move away from tall buildings or dense cover.\n2  Keep RunSphere open and location enabled.\n3  Wait a moment while we reconnect.`}</Text>
      <Text style={styles.provisional}>Looking for GPS… Last strong signal was recent.</Text>
      <PrimaryButton label="Try again" onPress={onRetry} />
      <Pressable onPress={onPause}>
        <Text style={styles.textButton}>Keep activity paused</Text>
      </Pressable>
    </View>
  );
}
function ActivityResults({
  session,
  onQueue,
  onDiscard
}: {
  session: ActivitySession;
  onQueue: () => void;
  onDiscard: () => void;
}) {
  const pace = session.distanceMeters
    ? formatDuration(Math.round(session.durationSeconds / (session.distanceMeters / 1000)))
    : '—';
  return (
    <View style={styles.recordCard}>
      <Text style={styles.eyebrow}>ACTIVITY COMPLETE · LOCAL RESULT</Text>
      <Text style={styles.recordTitle}>New ground covered</Text>
      <Text style={styles.lead}>
        Saved on this device. Distance, time, and pace are provisional until processing.
      </Text>
      <View style={styles.resultStats}>
        <Stat label="KM" value={(session.distanceMeters / 1000).toFixed(2)} detail="Provisional" />
        <Stat label="TIME" value={formatDuration(session.durationSeconds)} detail="Recorded" />
        <Stat label="PACE /KM" value={pace} detail="Provisional" />
      </View>
      <PrimaryButton label="Save activity" onPress={onQueue} />
      <Pressable onPress={onDiscard}>
        <Text style={styles.textButton}>Discard local activity</Text>
      </Pressable>
    </View>
  );
}
const formatDuration = (seconds: number) =>
  `${Math.floor(seconds / 3600)
    .toString()
    .padStart(2, '0')}:${Math.floor((seconds / 60) % 60)
    .toString()
    .padStart(2, '0')}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0')}`;
