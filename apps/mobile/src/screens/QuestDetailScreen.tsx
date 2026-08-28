import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { QuestDetail, QuestSummary } from '@runsphere/contracts';
import type { MobileApiClient } from '../api-client';
import { PrimaryButton, Stat } from '../components/primitives';
import { MapSurface } from '../maps/MapSurface';
import { useAppTheme } from '../theme/theme';
import {
  detailStateFor,
  selectedCheckpointLayers,
  selectedDetailInitialCenter,
  shouldDrawSelectedGeometry,
  type QuestDetailState
} from './explore-model';

/** Detail loads exactly once for an explicit list selection. It never preloads catalog details. */
export function QuestDetailScreen({
  api,
  quest,
  onBack,
  onStart
}: {
  api: MobileApiClient;
  quest: QuestSummary;
  onBack: () => void;
  onStart: () => void;
}) {
  const { tokens } = useAppTheme();
  const [detail, setDetail] = useState<QuestDetail>();
  const [error, setError] = useState<unknown>();
  useEffect(() => {
    let active = true;
    void api
      .getQuest(quest.id)
      .then((result) => active && setDetail(result))
      .catch((reason: unknown) => active && setError(reason));
    return () => {
      active = false;
    };
  }, [api, quest.id]);

  const state = detailStateFor(quest, detail, error);
  const layers = useMemo(
    () => (shouldDrawSelectedGeometry(state) ? selectedCheckpointLayers(detail) : []),
    [detail, state]
  );
  const initialCenter = useMemo(
    () => (shouldDrawSelectedGeometry(state) ? selectedDetailInitialCenter(detail) : undefined),
    [detail, state]
  );
  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to verified quests"
          onPress={onBack}
        >
          <Text style={[styles.back, { color: tokens.text.primary }]}>‹</Text>
        </Pressable>
        <Text style={[styles.eyebrow, { color: tokens.status.success }]}>VERIFIED QUEST</Text>
      </View>
      <Text accessibilityRole="header" style={[styles.title, { color: tokens.text.primary }]}>
        {quest.title}
      </Text>
      <Text style={[styles.copy, { color: tokens.text.secondary }]}>
        Checkpoint details are display-only. There is no prescribed order, arrival check, route, or
        completion action here.
      </Text>
      <View style={[styles.stats, { backgroundColor: tokens.background.surface }]}>
        <Stat
          label="DISTANCE"
          value={(quest.distanceMeters / 1000).toFixed(1)}
          suffix="km"
          detail="Published"
        />
        <Stat
          label="TIME"
          value={`${quest.estimatedActiveMinutes}`}
          suffix="min"
          detail="Active time"
        />
        <Stat label="STOPS" value={`${quest.checkpointCount}`} detail="Reviewed" />
      </View>
      <View style={styles.map}>
        <MapSurface
          accessibilityLabel={`Display-only checkpoint geometry for ${quest.title}`}
          localLayers={layers}
          {...(initialCenter ? { initialCenter } : {})}
        />
      </View>
      <DetailContent quest={quest} detail={detail} state={state} />
      <PrimaryButton label="Start a free activity" onPress={onStart} />
    </View>
  );
}

function DetailContent({
  quest,
  detail,
  state
}: {
  quest: QuestSummary;
  detail: QuestDetail | undefined;
  state: QuestDetailState;
}) {
  const { tokens } = useAppTheme();
  if (state === 'loading')
    return (
      <DetailState
        title="Loading checkpoint geometry"
        copy="Only this selected quest is being requested."
      />
    );
  if (state === 'offline')
    return (
      <DetailState
        title="Checkpoint details are offline"
        copy="The selected quest summary remains available."
      />
    );
  if (state === 'unavailable')
    return (
      <DetailState
        title="Quest unavailable"
        copy="This quest is no longer available. Return to the verified quest list for alternatives."
      />
    );
  if (state === 'closed')
    return (
      <DetailState
        title="Quest currently closed"
        copy={`Published hours: ${quest.openHours.schedule}. Browse other verified quests or start a free activity.`}
      />
    );
  if (state === 'error')
    return (
      <DetailState
        title="Checkpoint details unavailable"
        copy="Return to the verified quest list and choose another quest."
      />
    );
  return (
    <View
      style={[
        styles.checkpoints,
        { backgroundColor: tokens.background.surface, borderColor: tokens.border.subtle }
      ]}
      accessibilityRole="list"
    >
      <Text style={[styles.checkpointHeading, { color: tokens.text.primary }]}>
        Checkpoint details
      </Text>
      {detail?.checkpoints.map((checkpoint) => (
        <View
          key={checkpoint.id}
          style={[styles.checkpoint, { borderColor: tokens.border.subtle }]}
        >
          <Text style={[styles.checkpointTitle, { color: tokens.text.primary }]}>
            {checkpoint.title}
          </Text>
          <Text style={[styles.checkpointCopy, { color: tokens.text.secondary }]}>
            {checkpoint.accessibility} · {checkpoint.openHours.status} ·{' '}
            {checkpoint.openHours.schedule}
          </Text>
        </View>
      ))}
    </View>
  );
}

function DetailState({ title, copy }: { title: string; copy: string }) {
  const { tokens } = useAppTheme();
  return (
    <View
      style={[styles.state, { backgroundColor: tokens.background.surfaceInset }]}
      accessibilityLiveRegion="polite"
    >
      <Text style={[styles.checkpointTitle, { color: tokens.text.primary }]}>{title}</Text>
      <Text style={[styles.checkpointCopy, { color: tokens.text.secondary }]}>{copy}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 12, paddingBottom: 8 },
  header: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  back: { fontSize: 38, fontWeight: '500', lineHeight: 36 },
  eyebrow: { fontSize: 11, fontWeight: '900', letterSpacing: 1.3 },
  title: { fontSize: 30, fontWeight: '900', letterSpacing: -1 },
  copy: { fontSize: 14, lineHeight: 20 },
  stats: { borderRadius: 16, flexDirection: 'row', padding: 14 },
  map: { height: 220, overflow: 'hidden' },
  checkpoints: { borderRadius: 16, borderWidth: 1, overflow: 'hidden' },
  checkpointHeading: { fontSize: 16, fontWeight: '900', padding: 14 },
  checkpoint: { borderTopWidth: 1, padding: 14 },
  checkpointTitle: { fontSize: 15, fontWeight: '800' },
  checkpointCopy: { fontSize: 12, lineHeight: 18, marginTop: 4 },
  state: { borderRadius: 16, gap: 4, padding: 14 }
});
