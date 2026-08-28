import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { QuestSummary, WeeklyGoalResponse } from '@runsphere/contracts';
import type { MovementType } from '../activity-recorder-core';
import type { MobileApiClient } from '../api-client';
import { LoopMascot } from '../components/Mascot';
import { MovementChoice, PrimaryButton } from '../components/primitives';
import { useAppTheme } from '../theme/theme';
import {
  homeErrorState,
  homeStatusMessage,
  questDistanceLabel,
  questListState,
  type HomeRemoteState,
  weeklyGoalMetrics,
  weeklyGoalState
} from './home-state';

interface HomeRemoteData {
  readonly goal: WeeklyGoalResponse | undefined;
  readonly goalState: HomeRemoteState;
  readonly quests: readonly QuestSummary[];
  readonly questState: HomeRemoteState;
  readonly reloadGoals: () => void;
  readonly reloadQuests: () => void;
}

const useHomeRemoteData = (api: MobileApiClient, onSessionExpired: () => void): HomeRemoteData => {
  const [goal, setGoal] = useState<WeeklyGoalResponse>();
  const [goalState, setGoalState] = useState<HomeRemoteState>('loading');
  const [quests, setQuests] = useState<readonly QuestSummary[]>([]);
  const [questState, setQuestState] = useState<HomeRemoteState>('loading');
  const mounted = useRef(true);
  const goalGeneration = useRef(0);
  const questGeneration = useRef(0);
  const sessionExpirationHandled = useRef(false);

  const loadGoals = useCallback(() => {
    const generation = ++goalGeneration.current;
    setGoal(undefined);
    setGoalState('loading');
    void api
      .getWeeklyGoal()
      .then((next) => {
        if (!mounted.current || generation !== goalGeneration.current) return;
        setGoal(next);
        setGoalState(weeklyGoalState(next));
      })
      .catch((error: unknown) => {
        if (!mounted.current || generation !== goalGeneration.current) return;
        const state = homeErrorState(error);
        setGoalState(state);
        if (state === 'session-expired' && !sessionExpirationHandled.current) {
          sessionExpirationHandled.current = true;
          onSessionExpired();
        }
      });
  }, [api, onSessionExpired]);

  const loadQuests = useCallback(() => {
    const generation = ++questGeneration.current;
    setQuests([]);
    setQuestState('loading');
    void api
      .listQuests()
      .then((next) => {
        if (!mounted.current || generation !== questGeneration.current) return;
        setQuests(next);
        setQuestState(questListState(next));
      })
      .catch((error: unknown) => {
        if (!mounted.current || generation !== questGeneration.current) return;
        const state = homeErrorState(error);
        setQuestState(state);
        if (state === 'session-expired' && !sessionExpirationHandled.current) {
          sessionExpirationHandled.current = true;
          onSessionExpired();
        }
      });
  }, [api, onSessionExpired]);

  useEffect(() => {
    mounted.current = true;
    sessionExpirationHandled.current = false;
    loadGoals();
    loadQuests();
    return () => {
      mounted.current = false;
      goalGeneration.current += 1;
      questGeneration.current += 1;
    };
  }, [loadGoals, loadQuests]);

  return { goal, goalState, quests, questState, reloadGoals: loadGoals, reloadQuests: loadQuests };
};

export function HomeScreen({
  api,
  movement,
  onMovementChange,
  onStart,
  onOpenQuests,
  onOpenProfile,
  onSessionExpired
}: {
  api: MobileApiClient;
  movement: MovementType;
  onMovementChange: (movement: MovementType) => void;
  onStart: () => void;
  onOpenQuests: () => void;
  onOpenProfile: () => void;
  onSessionExpired: () => void;
}) {
  const { tokens } = useAppTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const { goal, goalState, quests, questState, reloadGoals, reloadQuests } = useHomeRemoteData(
    api,
    onSessionExpired
  );
  const metrics = goal ? weeklyGoalMetrics(goal) : [];
  const statusMessage = homeStatusMessage(goalState, questState);

  return (
    <>
      <Text accessibilityLiveRegion="polite" style={styles.liveStatus}>
        {statusMessage}
      </Text>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>HOME</Text>
        <Text style={styles.title}>Ready to find{`\n`}your next path?</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.eyebrow}>THIS WEEK</Text>
        {goalState === 'loading' && <WeeklySkeleton styles={styles} />}
        {goalState === 'ready' && (
          <>
            <Text style={styles.weekLabel}>Week of {goal?.weekStartsOn}</Text>
            {metrics.map((metric) => (
              <View key={metric.label} style={styles.metric}>
                <View style={styles.metricHeader}>
                  <View style={styles.metricCopy}>
                    <Text style={styles.metricTitle}>{metric.label}</Text>
                    <Text style={styles.metricValue}>
                      {metric.actual} <Text style={styles.metricGoal}>of {metric.goal}</Text>
                    </Text>
                  </View>
                  <Text style={styles.percent}>{metric.progress}%</Text>
                </View>
                <View
                  accessibilityLabel={`${metric.label}: ${metric.actual} of ${metric.goal}`}
                  accessibilityRole="progressbar"
                  accessibilityValue={{
                    min: 0,
                    max: 100,
                    now: metric.progress,
                    text: `${metric.progress}% complete`
                  }}
                  style={styles.progressTrack}
                >
                  <View style={[styles.progressFill, { width: `${metric.progress}%` }]} />
                </View>
              </View>
            ))}
            <Text style={styles.helper}>
              Validated activities only. Local queued activity is not included.
            </Text>
          </>
        )}
        {goalState === 'empty' && (
          <Guide
            styles={styles}
            variant="empty"
            label="Choose a distance or active-minute goal when you are ready."
            actionLabel="Set weekly goal"
            onAction={onOpenProfile}
          />
        )}
        {goalState === 'offline' && (
          <Guide
            styles={styles}
            variant="offline"
            label="Weekly progress is unavailable offline."
            actionLabel="Try again"
            onAction={reloadGoals}
          />
        )}
        {goalState === 'configuration' && (
          <Unavailable
            styles={styles}
            label="Weekly progress is unavailable until RunSphere is configured."
          />
        )}
        {goalState === 'error' && (
          <Unavailable
            styles={styles}
            label="Weekly progress is unavailable."
            actionLabel="Try again"
            onAction={reloadGoals}
          />
        )}
      </View>

      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.flexCopy}>
            <Text style={styles.eyebrow}>FREE ACTIVITY</Text>
            <Text style={styles.cardTitle}>Move your way</Text>
          </View>
          <Text style={styles.privateBadge}>PRIVATE</Text>
        </View>
        <Text style={styles.body}>
          Records locally first. Exact route, start, and finish stay private.
        </Text>
        <MovementChoice selected={movement} onChoose={onMovementChange} />
        <PrimaryButton label={`Start ${movement}`} onPress={onStart} />
      </View>

      <View style={styles.questHeader}>
        <Text style={styles.sectionTitle}>Verified quests</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Explore verified quests"
          onPress={onOpenQuests}
          style={styles.secondaryButton}
        >
          <Text style={styles.secondaryText}>Explore</Text>
        </Pressable>
      </View>
      {questState === 'loading' && <QuestLoading styles={styles} />}
      {questState === 'ready' &&
        quests.map((quest) => (
          <Pressable
            key={quest.id}
            accessibilityRole="button"
            accessibilityLabel={`Explore ${quest.title}, ${questDistanceLabel(quest.distanceMeters)}`}
            onPress={onOpenQuests}
            style={styles.questCard}
          >
            <View style={styles.flexCopy}>
              <Text style={styles.questTitle}>{quest.title}</Text>
              <Text style={styles.questDetail}>
                {questDistanceLabel(quest.distanceMeters)} · about {quest.estimatedActiveMinutes}{' '}
                min · {quest.accessibility}
              </Text>
            </View>
            <Text style={styles.questArrow}>›</Text>
          </Pressable>
        ))}
      {questState === 'empty' && (
        <Guide
          styles={styles}
          variant="empty"
          label="No verified quests are available right now. You can explore or start a free activity."
          actionLabel="Explore"
          onAction={onOpenQuests}
        />
      )}
      {questState === 'offline' && (
        <Guide
          styles={styles}
          variant="offline"
          label="Verified quests are unavailable offline."
          actionLabel="Try again"
          onAction={reloadQuests}
        />
      )}
      {questState === 'configuration' && (
        <Unavailable
          styles={styles}
          label="Verified quests are unavailable until RunSphere is configured."
        />
      )}
      {questState === 'error' && (
        <Unavailable
          styles={styles}
          label="Verified quests are unavailable."
          actionLabel="Try again"
          onAction={reloadQuests}
        />
      )}
    </>
  );
}

function WeeklySkeleton({ styles }: { styles: ReturnType<typeof createStyles> }) {
  return (
    <View>
      <View style={[styles.skeleton, styles.skeletonTitle]} />
      <View style={[styles.skeleton, styles.skeletonLine]} />
      <View style={[styles.skeleton, styles.skeletonProgress]} />
      <Text style={styles.helper}>Loading weekly progress.</Text>
    </View>
  );
}

function QuestLoading({ styles }: { styles: ReturnType<typeof createStyles> }) {
  return (
    <View style={styles.questLoading}>
      <LoopMascot variant="loading" accessibility={{ mode: 'decorative' }} size={48} />
      <Text style={styles.body}>Looking for verified quests.</Text>
    </View>
  );
}

function Guide({
  styles,
  variant,
  label,
  actionLabel,
  onAction
}: {
  styles: ReturnType<typeof createStyles>;
  variant: 'empty' | 'offline';
  label: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <View style={styles.guide}>
      <LoopMascot variant={variant} accessibility={{ mode: 'decorative' }} size={48} />
      <View style={styles.flexCopy}>
        <Text style={styles.body}>{label}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          onPress={onAction}
          style={styles.guideAction}
        >
          <Text style={styles.guideActionText}>{actionLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Unavailable({
  styles,
  label,
  actionLabel,
  onAction
}: {
  styles: ReturnType<typeof createStyles>;
  label: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.unavailable}>
      <Text style={styles.body}>{label}</Text>
      {actionLabel && onAction && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          onPress={onAction}
          style={styles.guideAction}
        >
          <Text style={styles.guideActionText}>{actionLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

const createStyles = (t: ReturnType<typeof useAppTheme>['tokens']) =>
  StyleSheet.create({
    liveStatus: { color: t.text.secondary, fontSize: 1, height: 1, opacity: 0, width: 1 },
    header: { justifyContent: 'center', marginBottom: 8, minHeight: 88 },
    flexCopy: { flex: 1 },
    eyebrow: { color: t.status.success, fontSize: 12, fontWeight: '900', letterSpacing: 1.2 },
    title: {
      color: t.text.primary,
      fontSize: 30,
      fontWeight: '900',
      letterSpacing: -1,
      lineHeight: 35,
      marginTop: 5
    },
    card: {
      backgroundColor: t.background.surface,
      borderColor: t.border.subtle,
      borderRadius: 22,
      borderWidth: 1,
      marginTop: 12,
      padding: 16
    },
    cardHeader: { alignItems: 'flex-start', flexDirection: 'row', gap: 12 },
    cardTitle: {
      color: t.text.primary,
      fontSize: 20,
      fontWeight: '900',
      lineHeight: 26,
      marginTop: 4
    },
    privateBadge: {
      backgroundColor: t.background.surfaceInset,
      borderRadius: 14,
      color: t.status.success,
      fontSize: 12,
      fontWeight: '900',
      overflow: 'hidden',
      paddingHorizontal: 9,
      paddingVertical: 6
    },
    body: { color: t.text.secondary, fontSize: 14, lineHeight: 21, marginTop: 8 },
    weekLabel: { color: t.text.secondary, fontSize: 12, lineHeight: 18, marginTop: 8 },
    metric: { marginTop: 13 },
    metricHeader: { alignItems: 'flex-start', flexDirection: 'row', gap: 12 },
    metricCopy: { flex: 1 },
    metricTitle: { color: t.text.secondary, fontSize: 12, fontWeight: '800' },
    metricValue: {
      color: t.text.primary,
      fontSize: 20,
      fontWeight: '900',
      lineHeight: 28,
      marginTop: 3
    },
    metricGoal: { color: t.text.secondary, fontSize: 14, fontWeight: '700' },
    percent: { color: t.status.success, fontSize: 13, fontWeight: '900', marginTop: 2 },
    progressTrack: {
      backgroundColor: t.background.surfaceInset,
      borderRadius: 8,
      height: 9,
      marginTop: 8,
      overflow: 'hidden'
    },
    progressFill: { backgroundColor: t.action.primary, borderRadius: 8, height: '100%' },
    helper: { color: t.text.secondary, fontSize: 12, lineHeight: 18, marginTop: 12 },
    skeleton: { backgroundColor: t.background.surfaceInset, borderRadius: 6, marginTop: 12 },
    skeletonTitle: { height: 24, width: '62%' },
    skeletonLine: { height: 16, width: '82%' },
    skeletonProgress: { height: 9, width: '100%' },
    guide: { alignItems: 'center', flexDirection: 'row', gap: 12, marginTop: 12, minHeight: 64 },
    guideAction: {
      alignSelf: 'flex-start',
      justifyContent: 'center',
      marginTop: 8,
      minHeight: 48,
      paddingHorizontal: 4
    },
    guideActionText: { color: t.action.primary, fontSize: 14, fontWeight: '900' },
    unavailable: { marginTop: 12, minHeight: 64 },
    questHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginTop: 24
    },
    sectionTitle: { color: t.text.primary, fontSize: 20, fontWeight: '900', lineHeight: 26 },
    secondaryButton: {
      alignItems: 'center',
      backgroundColor: t.background.surfaceInset,
      borderColor: t.border.subtle,
      borderRadius: 17,
      borderWidth: 1,
      justifyContent: 'center',
      minHeight: 48,
      paddingHorizontal: 16
    },
    secondaryText: { color: t.text.primary, fontSize: 14, fontWeight: '900' },
    questLoading: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 12,
      marginTop: 12,
      minHeight: 64
    },
    questCard: {
      alignItems: 'center',
      backgroundColor: t.background.surface,
      borderColor: t.border.subtle,
      borderRadius: 18,
      borderWidth: 1,
      flexDirection: 'row',
      marginTop: 12,
      minHeight: 80,
      paddingHorizontal: 16,
      paddingVertical: 12
    },
    questTitle: { color: t.text.primary, fontSize: 17, fontWeight: '900', lineHeight: 22 },
    questDetail: { color: t.text.secondary, fontSize: 12, lineHeight: 18, marginTop: 4 },
    questArrow: { color: t.action.primary, fontSize: 28, fontWeight: '700', marginLeft: 12 }
  });
