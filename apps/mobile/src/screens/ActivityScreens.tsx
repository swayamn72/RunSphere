import * as Location from 'expo-location';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Linking, Pressable, Text, View } from 'react-native';
import type { LngLat } from '@maplibre/maplibre-react-native';
import { activityRecorder } from '../activity-recorder.native';
import {
  type ActivitySession,
  type MovementType,
  type RecordingState
} from '../activity-recorder-core';
import { recordingLocationAdapter } from '../location-adapter';
import {
  ACQUISITION_TIMEOUT_MS,
  cancelAcquisition,
  type AcquisitionState
} from '../activity-acquisition';
import {
  acquisitionStatusCopy,
  beginPreparationAcquisition,
  preparationFix,
  preparationTimeout
} from '../activity-preparation-model';
import {
  getRecordingLocationPermissionState,
  type RecordingLocationPermissionState
} from '../location-permission';
import { type createActivitySyncCoordinator } from '../activity-sync';
import type { ActivityStatus } from '../api-client';
import { MovementChoice, PrimaryButton, Stat } from '../components/primitives';
import { useAppStyles } from '../components/styles';
import { MapSurface } from '../maps/MapSurface';
import {
  classifyLiveGps,
  formatLastClear,
  formatProvisionalDistance,
  formatProvisionalDuration,
  latestUsableSample,
  liveRouteLayers,
  provisionalPace
} from './live-activity-model';
import type { RecordedLocationSample } from '../activity-recorder-core';

export function ActivityPreparation({
  accountId,
  initialMovement,
  originLabel,
  onChange,
  onExit
}: {
  accountId: string;
  initialMovement: MovementType;
  originLabel?: string;
  onChange: (session: ActivitySession) => void;
  onExit: () => void;
}) {
  const styles = useAppStyles();
  const [movement, setMovement] = useState<MovementType>(initialMovement);
  const [permission, setPermission] = useState<RecordingLocationPermissionState>('unrequested');
  const [acquisition, setAcquisition] = useState<AcquisitionState>();
  const [message, setMessage] = useState<string>();
  const mounted = useRef(false);
  const starting = useRef(false);
  const activationStarted = useRef(false);
  const acquisitionState = useRef<AcquisitionState | undefined>(undefined);
  const acquisitionGeneration = useRef(0);
  const subscription = useRef<Location.LocationSubscription | undefined>(undefined);
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const cleanup = () => {
    acquisitionGeneration.current += 1;
    subscription.current?.remove();
    subscription.current = undefined;
    if (timeout.current) clearTimeout(timeout.current);
    timeout.current = undefined;
  };
  const showAcquisition = (next: AcquisitionState) => {
    acquisitionState.current = next;
    setAcquisition(next);
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cleanup();
    };
  }, []);
  useEffect(() => {
    const appState = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || permission !== 'blocked') return;
      void Location.getForegroundPermissionsAsync()
        .then((current) => {
          if (!mounted.current) return;
          const next = getRecordingLocationPermissionState(current);
          setPermission(next);
          if (next === 'precise') setMessage(undefined);
        })
        .catch(() => mounted.current && setPermission('failure'));
    });
    return () => appState.remove();
  }, [permission]);

  const cancelAcquiring = () => {
    cleanup();
    activationStarted.current = false;
    if (acquisitionState.current) showAcquisition(cancelAcquisition(acquisitionState.current));
    starting.current = false;
  };
  const activateAfterGate = async () => {
    if (!starting.current || activationStarted.current) return;
    activationStarted.current = true;
    cleanup();
    const now = new Date().toISOString();
    const id = `activity-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      // Deliberate M1 deviation: preparation remains in-memory until the acquisition gate passes.
      // No pre-route row or acquisition fix can enter recovery/history; legacy rows are discarded at init.
      await activityRecorder.create({
        id,
        accountId,
        movementType: movement,
        state: 'active',
        startedAt: now,
        updatedAt: now,
        lastHeartbeatAt: now
      });
      const session = await activityRecorder.get(id, accountId);
      if (!mounted.current || !session) {
        await activityRecorder.remove(id, accountId);
        return;
      }
      onChange(session);
    } catch {
      if (mounted.current) {
        setPermission('failure');
        setMessage('Recording could not start. No route or distance was created. Try again.');
      }
    } finally {
      activationStarted.current = false;
      starting.current = false;
    }
  };
  const beginAcquisition = async () => {
    const generation = ++acquisitionGeneration.current;
    const initial = beginPreparationAcquisition(Date.now());
    showAcquisition(initial);
    setMessage(undefined);
    try {
      const nextSubscription = await recordingLocationAdapter.subscribe((sample) => {
        if (!mounted.current || generation !== acquisitionGeneration.current) return;
        const current = acquisitionState.current;
        if (!current) return;
        const next = preparationFix(current, sample, Date.now());
        showAcquisition(next);
        if (next.status === 'ready' && current.status === 'acquiring') void activateAfterGate();
      });
      if (!mounted.current || !starting.current || generation !== acquisitionGeneration.current) {
        nextSubscription.remove();
        return;
      }
      subscription.current = nextSubscription;
      timeout.current = setTimeout(() => {
        if (!mounted.current || generation !== acquisitionGeneration.current) return;
        const current = acquisitionState.current;
        if (!current) return;
        const next = preparationTimeout(current, Date.now());
        showAcquisition(next);
        if (next.status === 'timed-out') {
          cleanup();
          starting.current = false;
          setMessage(
            'We did not get three clear fixes in 30 seconds. No route or distance was created.'
          );
        }
      }, ACQUISITION_TIMEOUT_MS);
    } catch {
      starting.current = false;
      if (mounted.current) {
        setPermission('failure');
        setMessage('We could not read your location. No route or distance was created. Try again.');
      }
    }
  };
  const begin = async () => {
    if (starting.current) return;
    starting.current = true;
    setPermission('requesting');
    setMessage(undefined);
    try {
      const current = await Location.getForegroundPermissionsAsync();
      const currentState = getRecordingLocationPermissionState(current);
      const response =
        currentState === 'precise' ? current : await Location.requestForegroundPermissionsAsync();
      const next = getRecordingLocationPermissionState(response);
      if (!mounted.current) return;
      setPermission(next);
      if (next !== 'precise') {
        starting.current = false;
        setMessage(
          next === 'approximate'
            ? 'Recording needs precise location. No route or distance was created.'
            : 'Location was not granted. No route or distance was created.'
        );
        return;
      }
      await beginAcquisition();
    } catch {
      starting.current = false;
      if (mounted.current) {
        setPermission('failure');
        setMessage(
          'We could not check location permission. No route or distance was created. Try again.'
        );
      }
    }
  };
  const retry = () => {
    cleanup();
    acquisitionState.current = undefined;
    activationStarted.current = false;
    starting.current = false;
    void begin();
  };
  const isAcquiring = acquisition?.status === 'acquiring';
  const isActivating = acquisition?.status === 'ready';
  const needsSettings = permission === 'blocked';
  return (
    <View style={styles.recordCard}>
      <Text style={styles.eyebrow}>FREE ACTIVITY</Text>
      <Text style={styles.recordTitle}>Prepare your private activity.</Text>
      <Text style={styles.lead}>
        Current location is used only while RunSphere is open to build a private route and distance.
        It is retained on this device only after recording starts. No background location is
        requested.
      </Text>
      {originLabel && <Text style={styles.privateNote}>Started from {originLabel}</Text>}
      <MovementChoice selected={movement} onChoose={setMovement} />
      {isAcquiring && (
        <View style={styles.notice} accessibilityLiveRegion="polite">
          <View style={styles.flexCopy}>
            <Text style={styles.noticeTitle}>Finding a clear GPS signal</Text>
            <Text style={styles.noticeCopy}>{acquisitionStatusCopy(acquisition)}</Text>
          </View>
        </View>
      )}
      {message && (
        <View style={[styles.notice, styles.warningNotice]} accessibilityLiveRegion="polite">
          <View style={styles.flexCopy}>
            <Text style={styles.noticeTitle}>
              {needsSettings ? 'Location is blocked' : 'Location needs attention'}
            </Text>
            <Text style={styles.noticeCopy}>{message}</Text>
          </View>
        </View>
      )}
      {needsSettings ? (
        <PrimaryButton label="Open location settings" onPress={() => void Linking.openSettings()} />
      ) : (
        <PrimaryButton
          label={
            permission === 'requesting'
              ? 'Checking location…'
              : isAcquiring
                ? 'Finding GPS…'
                : 'Start recording'
          }
          disabled={permission === 'requesting' || isAcquiring || isActivating}
          onPress={() => void begin()}
        />
      )}
      {(permission === 'denied' ||
        permission === 'approximate' ||
        permission === 'failure' ||
        acquisition?.status === 'timed-out') && (
        <Pressable accessibilityRole="button" onPress={retry}>
          <Text style={styles.textButton}>Retry location</Text>
        </Pressable>
      )}
      {isAcquiring && (
        <Pressable accessibilityRole="button" onPress={cancelAcquiring}>
          <Text style={styles.textButton}>Cancel GPS check</Text>
        </Pressable>
      )}
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          cancelAcquiring();
          onExit();
        }}
      >
        <Text style={styles.textButton}>{originLabel ? `Back to ${originLabel}` : 'Not now'}</Text>
      </Pressable>
    </View>
  );
}

export function ActivityRecording({
  session,
  accountId,
  onChange,
  onExit,
  sync
}: {
  session: ActivitySession;
  accountId: string;
  onChange: (session: ActivitySession | undefined) => void;
  onExit: () => void;
  sync: ReturnType<typeof createActivitySyncCoordinator>;
}) {
  const styles = useAppStyles();
  const [current, setCurrent] = useState(session);
  const [samples, setSamples] = useState<RecordedLocationSample[]>([]);
  const [now, setNow] = useState(Date.now());
  const [cameraMode, setCameraMode] = useState<'follow' | 'free-pan'>('follow');
  const [recenterRequest, setRecenterRequest] = useState<{ id: number; coordinate: LngLat }>();
  const [subscriptionError, setSubscriptionError] = useState<string>();
  const mounted = useRef(true);
  const refreshGeneration = useRef(0);
  const sessionRef = useRef({ id: session.id, accountId });
  sessionRef.current = { id: current.id, accountId };

  const refresh = useCallback(async (): Promise<ActivitySession | undefined> => {
    const generation = ++refreshGeneration.current;
    const identity = sessionRef.current;
    const [fresh, trace] = await Promise.all([
      activityRecorder.get(identity.id, identity.accountId),
      activityRecorder.liveSamples(identity.id, identity.accountId)
    ]);
    if (
      !mounted.current ||
      generation !== refreshGeneration.current ||
      identity.id !== sessionRef.current.id
    )
      return fresh;
    if (fresh) setCurrent(fresh);
    setSamples(trace);
    return fresh;
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      refreshGeneration.current += 1;
    };
  }, []);
  useEffect(() => {
    let subscription: Location.LocationSubscription | undefined;
    let cancelled = false;
    void refresh();
    if (['active', 'resumed'].includes(current.state)) {
      void recordingLocationAdapter
        .subscribe(async (sample) => {
          await activityRecorder.appendSample(current.id, accountId, sample);
          if (!cancelled) await refresh();
        })
        .then((next) => {
          if (cancelled) next.remove();
          else subscription = next;
        })
        .catch(() => {
          if (!cancelled && mounted.current)
            setSubscriptionError(
              'Location updates could not start. Your saved route remains private; retry by pausing and resuming.'
            );
        });
    }
    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [accountId, current.id, current.state, refresh]);
  useEffect(() => {
    if (!['active', 'resumed'].includes(current.state)) return;
    const interval = setInterval(() => {
      setNow(Date.now());
      void activityRecorder
        .heartbeat(current.id, accountId, new Date().toISOString())
        .then(() => void refresh());
    }, 5_000);
    return () => clearInterval(interval);
  }, [accountId, current.id, current.state, refresh]);

  const transition = async (to: RecordingState) => {
    const from = current.state;
    await activityRecorder.transition(
      current.id,
      accountId,
      from,
      to,
      new Date().toISOString(),
      to === 'paused' ? 'manual' : undefined
    );
    const fresh = await refresh();
    if (fresh) onChange(fresh);
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
    const fresh = await refresh();
    if (fresh) onChange(fresh);
  };
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
          onExit();
        }}
      />
    );
  if (['queued', 'failed', 'processed'].includes(current.state))
    return <ActivityDetail session={current} sync={sync} onExit={onExit} />;

  const status = classifyLiveGps({ state: current.state, samples, now });
  const latest = latestUsableSample(samples);
  const center = useMemo(
    () => (latest ? ([latest.longitude, latest.latitude] as LngLat) : undefined),
    [latest?.latitude, latest?.longitude]
  );
  const layers = useMemo(() => liveRouteLayers(samples), [samples]);
  const recoveredPause = current.state === 'paused' && current.pauseReason === 'recovered';
  return (
    <View style={styles.liveScreen}>
      <MapSurface
        localLayers={layers}
        accessibilityLabel="Private activity route stored only on this device."
        {...(center ? { initialCenter: center, liveCenter: center, initialFollow: true } : {})}
        recenterEnabled={Boolean(center)}
        onEnterFreePan={() => setCameraMode('free-pan')}
        onRequestRecenter={() => {
          if (!center) return;
          const request = { id: (recenterRequest?.id ?? 0) + 1, coordinate: center };
          setRecenterRequest(request);
          setCameraMode('follow');
        }}
        {...(recenterRequest ? { recenterRequest } : {})}
      />
      <View style={styles.liveOverlay}>
        <Text style={styles.eyebrow}>
          {current.movementType.toUpperCase()} · PRIVATE ON THIS DEVICE
        </Text>
        <Text style={styles.liveDistance}>{formatProvisionalDistance(current.distanceMeters)}</Text>
        <Text style={styles.provisional}>PROVISIONAL DISTANCE · ACCURACY-FILTERED</Text>
        <Text style={styles.privateNote}>
          {cameraMode === 'follow'
            ? 'Following your private local route'
            : 'Free pan — recording continues privately'}
        </Text>
        <View accessibilityLiveRegion="polite" style={styles.liveStatus}>
          <Text style={styles.noticeTitle}>
            {status.state === 'strong' ? 'GPS clear' : status.state.toUpperCase()}
          </Text>
          <Text style={styles.noticeCopy}>{status.message}</Text>
          <Text style={styles.noticeCopy}>{formatLastClear(status.lastUsableAt, now)}</Text>
          {(status.state === 'weak' || status.state === 'gap') && (
            <Text style={styles.noticeCopy}>
              Move to open sky, keep RunSphere open, and wait for a clear fix. We will start a new
              segment without filling the gap.
            </Text>
          )}
        </View>
        {subscriptionError && (
          <View accessibilityLiveRegion="polite" style={styles.liveStatus}>
            <Text style={styles.noticeCopy}>{subscriptionError}</Text>
          </View>
        )}
        <View style={styles.liveStats}>
          <Stat
            label="ACTIVE TIME"
            value={formatProvisionalDuration(current.durationSeconds)}
            detail="Provisional"
          />
          <Stat label="PACE /KM" value={provisionalPace(current)} detail="Provisional" />
        </View>
        {current.state === 'paused' ? (
          <>
            <Text style={styles.noticeCopy}>
              {recoveredPause
                ? 'Recovered activity: recording remains paused until you explicitly resume.'
                : 'Activity paused. Resume when you are ready.'}
            </Text>
            <PrimaryButton label="Resume activity" onPress={() => void transition('resumed')} />
          </>
        ) : (
          <PrimaryButton label="Pause activity" onPress={() => void transition('paused')} />
        )}
        <Pressable accessibilityRole="button" onPress={() => void finish()}>
          <Text style={styles.textButton}>Finish activity</Text>
        </Pressable>
      </View>
    </View>
  );
}

function ActivityDetail({
  session,
  sync,
  onExit
}: {
  session: ActivitySession;
  sync: ReturnType<typeof createActivitySyncCoordinator>;
  onExit: () => void;
}) {
  const styles = useAppStyles();
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
    onExit();
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
      <Pressable accessibilityRole="button" onPress={onExit}>
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
  const styles = useAppStyles();
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
            <Text style={styles.noticeCopy}>
              Your completed activities will appear here privately.
            </Text>
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

function ActivityResults({
  session,
  onQueue,
  onDiscard
}: {
  session: ActivitySession;
  onQueue: () => void;
  onDiscard: () => void;
}) {
  const styles = useAppStyles();
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
