import { useEffect, useMemo, useState } from 'react';
import { space } from '@runsphere/ui';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../components/Text';
import type { QuestDetail, QuestSummary } from '@runsphere/contracts';
import type { MobileApiClient } from '../api-client';
import { PrimaryButton } from '../components/primitives';
import { QuestProgressCard } from './QuestProgressCard';
import { QuestStopMarkers } from './QuestStopMarkers';
import { MapSurface } from '../maps/MapSurface';
import { Chevron } from '../components/Chevron';
import { useAppTheme } from '../theme/theme';
import { gameWorld } from '../theme/game-world';
import { detailStateFor, shouldDrawSelectedGeometry, type QuestDetailState } from './explore-model';
import {
  SUGGESTED_ROUTE_NOTE,
  questBounds,
  questMapLayers,
  questStops,
  timeLimitLabel,
  type QuestStop
} from './quest-map-model';
import { QUEST_START_HINT, questRunStart, type QuestProgress } from './quest-progress-model';
import { dashboardPreviewEnabled, previewTurfQuests } from './dashboard-preview';
import type { RunStart } from '../run-start';

/**
 * A quest opens on its own map: its stops, numbered in a suggested order, and
 * a dashed line round them, with no turf drawn. Opened from a pin on the Map
 * tab or a quest in the list. Detail loads exactly once for that quest; the
 * catalog is never preloaded.
 */
export function QuestDetailScreen({
  api,
  quest,
  onBack,
  onStart
}: {
  api: MobileApiClient;
  quest: QuestSummary;
  onBack: () => void;
  /** Called with a quest run for this quest; only offered once it's taken on. */
  onStart: (start: RunStart) => void;
}) {
  const { tokens, reduceMotion } = useAppTheme();
  // Sample quests (preview mode) have no account behind them to take on or run.
  const sample = useMemo(
    () =>
      dashboardPreviewEnabled
        ? previewTurfQuests.find((entry) => entry.id === quest.id)
        : undefined,
    [quest.id]
  );
  const [detail, setDetail] = useState<QuestDetail | undefined>(sample);
  const [progress, setProgress] = useState<QuestProgress>();
  const start = questRunStart(quest.id, progress);
  const [error, setError] = useState<unknown>();
  useEffect(() => {
    if (sample) return;
    let active = true;
    void api
      .getQuest(quest.id)
      .then((result) => active && setDetail(result))
      .catch((reason: unknown) => active && setError(reason));
    return () => {
      active = false;
    };
  }, [api, quest.id, sample]);

  const state = detailStateFor(quest, detail, error);
  const drawn = shouldDrawSelectedGeometry(state) ? detail : undefined;
  const from = detail?.mapPosition ?? quest.mapPosition;
  const timeLimit = timeLimitLabel(detail?.timeLimitMinutes ?? quest.timeLimitMinutes);
  const stops = useMemo(() => (drawn ? questStops(drawn.checkpoints, from) : []), [drawn, from]);
  const layers = useMemo(() => questMapLayers(drawn, from ? { from } : {}), [drawn, from]);
  const bounds = useMemo(
    () => (drawn ? questBounds(drawn.checkpoints, from) : undefined),
    [drawn, from]
  );

  return (
    <View style={styles.root}>
      <View style={styles.map}>
        <MapSurface
          // Remount once the stops arrive, so the camera fits them: the fit is
          // applied when the map's style loads.
          key={bounds ? 'stops' : 'waiting'}
          accessibilityLabel={`Map of ${quest.title} with its stops`}
          localLayers={layers}
          world
          showAttribution={false}
          {...(from ? { initialCenter: from } : {})}
          {...(bounds
            ? { fitBounds: { bounds, padding: 48, duration: reduceMotion ? 0 : 400 } }
            : {})}
        >
          <QuestStopMarkers stops={stops} />
        </MapSurface>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={onBack}
          style={[styles.back, { backgroundColor: tokens.map.control }]}
        >
          <Chevron direction="back" color={tokens.map.controlText} />
        </Pressable>
      </View>
      <ScrollView
        style={[styles.panel, { backgroundColor: tokens.background.canvas }]}
        contentContainerStyle={styles.panelContent}
      >
        <Text style={[styles.eyebrow, { color: tokens.text.secondary }]}>QUEST</Text>
        <Text accessibilityRole="header" style={[styles.title, { color: tokens.text.primary }]}>
          {quest.title}
        </Text>
        <Text style={[styles.facts, { color: tokens.text.secondary }]}>
          {(quest.distanceMeters / 1000).toFixed(1)} km · {quest.estimatedActiveMinutes} min ·{' '}
          {quest.checkpointCount} {quest.checkpointCount === 1 ? 'stop' : 'stops'}
        </Text>
        {timeLimit ? (
          <Text style={[styles.copy, { color: tokens.text.primary }]}>{timeLimit}</Text>
        ) : null}
        <StopList quest={quest} stops={stops} state={state} />
        {sample ? (
          <Text style={[styles.copy, { color: tokens.text.secondary }]}>
            Sample quest. Pick a real one from the quest list to run it.
          </Text>
        ) : (
          <>
            <QuestProgressCard api={api} questId={quest.id} onProgress={setProgress} />
            {!start && progress && progress !== 'taken' && (
              <Text style={[styles.copy, { color: tokens.text.secondary }]}>
                {QUEST_START_HINT[progress]}
              </Text>
            )}
          </>
        )}
      </ScrollView>
      {/* Pinned, so the one action stays in the thumb zone however long the stop list is. */}
      {!sample && start ? (
        <View
          style={[
            styles.footer,
            { backgroundColor: tokens.background.canvas, borderTopColor: tokens.border.subtle }
          ]}
        >
          <PrimaryButton label="Start this quest" onPress={() => onStart(start)} />
        </View>
      ) : null}
    </View>
  );
}

function StopList({
  quest,
  stops,
  state
}: {
  quest: QuestSummary;
  stops: readonly QuestStop[];
  state: QuestDetailState;
}) {
  const { tokens } = useAppTheme();
  const message =
    state === 'loading'
      ? 'Loading the stops…'
      : state === 'offline'
        ? "You're offline. The stops show once you're back."
        : state === 'unavailable'
          ? "This quest isn't available any more. Pick another from the list."
          : state === 'error'
            ? "Couldn't load the stops. Go back and try another quest."
            : undefined;
  if (message)
    return (
      <Text
        accessibilityLiveRegion="polite"
        style={[styles.copy, { color: tokens.text.secondary }]}
      >
        {message}
      </Text>
    );
  return (
    <View accessibilityRole="list" style={styles.stops}>
      {state === 'closed' && (
        <Text style={[styles.copy, { color: tokens.text.secondary }]}>
          {`Closed right now. Open hours: ${quest.openHours.schedule}.`}
        </Text>
      )}
      <Text style={[styles.copy, { color: tokens.text.secondary }]}>{SUGGESTED_ROUTE_NOTE}</Text>
      {stops.map((stop) => (
        <View key={stop.id} style={styles.stop}>
          <View style={styles.stopNumber}>
            <Text style={styles.stopNumberText}>{stop.number}</Text>
          </View>
          <Text style={[styles.stopTitle, { color: tokens.text.primary }]}>{stop.title}</Text>
        </View>
      ))}
      <Text style={[styles.small, { color: tokens.text.secondary }]}>
        The dashed line joins the stops; follow the streets between them. TURFR checks your run when
        it's uploaded, so there's nothing to tap at each stop.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  map: { flex: 1, minHeight: 260 },
  back: {
    alignItems: 'center',
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    left: 16,
    position: 'absolute',
    top: 12,
    width: 44
  },
  backText: { fontSize: 28, fontWeight: '500', lineHeight: 34 },
  panel: { flexGrow: 0, maxHeight: '52%' },
  footer: { borderTopWidth: 1, paddingBottom: space.xl, paddingHorizontal: space.xl },
  panelContent: { gap: 10, padding: space.xl, paddingBottom: space.xxl },
  eyebrow: { fontSize: 11, fontWeight: '700', letterSpacing: 1.2 },
  title: { fontSize: 28, fontWeight: '700', letterSpacing: -0.5 },
  facts: { fontSize: 14, fontWeight: '700' },
  copy: { fontSize: 14, lineHeight: 20 },
  small: { fontSize: 12, lineHeight: 17 },
  stops: { gap: space.sm },
  stop: { alignItems: 'center', flexDirection: 'row', gap: space.md },
  stopNumber: {
    alignItems: 'center',
    backgroundColor: gameWorld.quest.marker,
    borderColor: gameWorld.quest.markerEdge,
    borderRadius: 14,
    borderWidth: 2,
    height: 28,
    justifyContent: 'center',
    width: 28
  },
  stopNumberText: { color: gameWorld.quest.ink, fontSize: 13, fontWeight: '700' },
  stopTitle: { flex: 1, fontSize: 15, fontWeight: '700' }
});
