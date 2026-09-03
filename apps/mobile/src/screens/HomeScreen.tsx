import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type {
  Profile,
  ProgressionSummary,
  QuestSummary,
  WeeklyGoalResponse
} from '@runsphere/contracts';
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
import {
  consistencyPresentation,
  progressionCardState,
  progressionErrorState,
  progressionPresentation,
  progressionStatusMessage,
  type ConsistencyPresentation,
  type ProgressionCardState,
  type ProgressionPresentation
} from './home-progression-model';

interface HomeRemoteData {
  readonly goal: WeeklyGoalResponse | undefined;
  readonly goalState: HomeRemoteState;
  readonly quests: readonly QuestSummary[];
  readonly questState: HomeRemoteState;
  readonly progression: ProgressionSummary | undefined;
  readonly progressionState: ProgressionCardState;
  readonly profile: Profile | undefined;
  readonly reloadGoals: () => void;
  readonly reloadQuests: () => void;
  readonly reloadProgression: () => void;
}

const useHomeRemoteData = (api: MobileApiClient, onSessionExpired: () => void): HomeRemoteData => {
  const [goal, setGoal] = useState<WeeklyGoalResponse>();
  const [goalState, setGoalState] = useState<HomeRemoteState>('loading');
  const [quests, setQuests] = useState<readonly QuestSummary[]>([]);
  const [questState, setQuestState] = useState<HomeRemoteState>('loading');
  const [progression, setProgression] = useState<ProgressionSummary>();
  const [progressionState, setProgressionState] = useState<ProgressionCardState>('loading');
  const [profile, setProfile] = useState<Profile>();
  const mounted = useRef(true);
  const goalGeneration = useRef(0);
  const questGeneration = useRef(0);
  const progressionGeneration = useRef(0);
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

  /**
   * The server owns XP, level, and weekly consistency (ADR-0005), so Home only
   * reads the summary. It never calls `POST /v1/progression/sync`, which would
   * make rendering Home a write, and never projects the open week locally.
   */
  const loadProgression = useCallback(() => {
    const generation = ++progressionGeneration.current;
    setProgression(undefined);
    setProfile(undefined);
    setProgressionState('loading');
    void api
      .getProgressionSummary()
      .then((next) => {
        if (!mounted.current || generation !== progressionGeneration.current) return;
        setProgression(next);
        setProgressionState(progressionCardState(next));
      })
      .catch((error: unknown) => {
        if (!mounted.current || generation !== progressionGeneration.current) return;
        const state = progressionErrorState(error);
        setProgressionState(state);
        if (state === 'session-expired' && !sessionExpirationHandled.current) {
          sessionExpirationHandled.current = true;
          onSessionExpired();
        }
      });
    // The cosmetic tier is decoration on a card the progression summary already
    // fills. A missing profile answers `404`, so a failure here must leave the
    // chip off rather than block progression or invent an identity.
    void api
      .getProfile()
      .then((next) => {
        if (!mounted.current || generation !== progressionGeneration.current) return;
        setProfile(next);
      })
      .catch(() => undefined);
  }, [api, onSessionExpired]);

  useEffect(() => {
    mounted.current = true;
    sessionExpirationHandled.current = false;
    loadGoals();
    loadQuests();
    loadProgression();
    return () => {
      mounted.current = false;
      goalGeneration.current += 1;
      questGeneration.current += 1;
      progressionGeneration.current += 1;
    };
  }, [loadGoals, loadProgression, loadQuests]);

  return {
    goal,
    goalState,
    quests,
    questState,
    progression,
    progressionState,
    profile,
    reloadGoals: loadGoals,
    reloadQuests: loadQuests,
    reloadProgression: loadProgression
  };
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
  const {
    goal,
    goalState,
    quests,
    questState,
    progression,
    progressionState,
    profile,
    reloadGoals,
    reloadQuests,
    reloadProgression
  } = useHomeRemoteData(api, onSessionExpired);
  const metrics = goal ? weeklyGoalMetrics(goal) : [];
  const progressionCard = progression ? progressionPresentation(progression, profile) : undefined;
  const consistencyCard = progression ? consistencyPresentation(progression) : undefined;
  const statusMessage = homeStatusMessage(
    goalState,
    questState,
    progressionStatusMessage(progressionState)
  );

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

      <ProgressionCard
        styles={styles}
        state={progressionState}
        card={progressionCard}
        onRetry={reloadProgression}
      />
      {consistencyCard && <ConsistencyCard styles={styles} card={consistencyCard} />}

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

/**
 * Cosmetic progression only (ADR-0005). Every value shown is copied from the
 * server summary; an unpublished rule shows the XP total with no level rather
 * than an invented level 1.
 */
function ProgressionCard({
  styles,
  state,
  card,
  onRetry
}: {
  styles: ReturnType<typeof createStyles>;
  state: ProgressionCardState;
  card: ProgressionPresentation | undefined;
  onRetry: () => void;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.flexCopy}>
          <Text style={styles.eyebrow}>PROGRESSION</Text>
          <Text style={styles.cardTitle}>Cosmetic only</Text>
        </View>
        {card?.tierLabel && <Text style={styles.tierBadge}>{card.tierLabel.toUpperCase()}</Text>}
      </View>
      {state === 'loading' && (
        <View>
          <View style={[styles.skeleton, styles.skeletonTitle]} />
          <View style={[styles.skeleton, styles.skeletonProgress]} />
          <Text style={styles.helper}>Loading progression.</Text>
        </View>
      )}
      {(state === 'ready' || state === 'unpublished') && card && (
        <>
          <Text style={styles.xpTotal}>{card.totalXpLabel}</Text>
          {card.level ? (
            <View style={styles.metric}>
              <View style={styles.metricHeader}>
                <View style={styles.metricCopy}>
                  <Text style={styles.metricTitle}>{card.level.levelLabel.toUpperCase()}</Text>
                  <Text style={styles.levelDetail}>{card.level.xpInLevelLabel}</Text>
                </View>
                {card.level.progress !== undefined && (
                  <Text style={styles.percent}>{card.level.progress}%</Text>
                )}
              </View>
              {card.level.progress !== undefined && (
                <View
                  accessibilityLabel={card.level.progressAccessibilityLabel}
                  accessibilityRole="progressbar"
                  accessibilityValue={{
                    min: 0,
                    max: 100,
                    now: card.level.progress,
                    text: `${card.level.progress}% of this level`
                  }}
                  style={styles.progressTrack}
                >
                  <View style={[styles.progressFill, { width: `${card.level.progress}%` }]} />
                </View>
              )}
            </View>
          ) : (
            <Text style={styles.helper}>
              Cosmetic levels are not published yet, so only your XP total is available.
            </Text>
          )}
          <Text style={styles.helper}>
            XP is cosmetic. It never changes quest eligibility, validation, or who you are matched
            with.
          </Text>
        </>
      )}
      {state === 'offline' && (
        <Guide
          styles={styles}
          variant="offline"
          label="Progression is unavailable offline."
          actionLabel="Try again"
          onAction={onRetry}
        />
      )}
      {state === 'unavailable' && (
        <Unavailable
          styles={styles}
          label="Progression is not available on this server yet."
          actionLabel="Try again"
          onAction={onRetry}
        />
      )}
      {state === 'configuration' && (
        <Unavailable
          styles={styles}
          label="Progression is unavailable until RunSphere is configured."
        />
      )}
      {state === 'error' && (
        <Unavailable
          styles={styles}
          label="Progression is unavailable."
          actionLabel="Try again"
          onAction={onRetry}
        />
      )}
    </View>
  );
}

/**
 * Non-punitive weekly consistency (ADR-0005). The server reports how many days
 * were active, never which ones, so the pips are an unlabelled count meter read
 * to TalkBack as a single count. Inactive pips are neutral, never an error or
 * warning color, and a quiet week is never framed as a loss.
 */
function ConsistencyCard({
  styles,
  card
}: {
  styles: ReturnType<typeof createStyles>;
  card: ConsistencyPresentation;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.flexCopy}>
          <Text style={styles.eyebrow}>CONSISTENCY</Text>
          <Text style={styles.cardTitle}>{card.weekLabel}</Text>
        </View>
        {card.goalLabel && <Text style={styles.goalBadge}>{card.goalLabel.toUpperCase()}</Text>}
      </View>
      <View
        accessible
        accessibilityLabel={card.accessibilityLabel}
        importantForAccessibility="yes"
        style={styles.pipRow}
      >
        {card.pips.map((pip) => (
          <View
            key={pip.index}
            importantForAccessibility="no-hide-descendants"
            style={[styles.pip, pip.active ? styles.pipActive : styles.pipInactive]}
          />
        ))}
      </View>
      <Text style={styles.metricValue}>{card.activeDaysLabel}</Text>
      <Text style={styles.levelDetail}>{card.cappedMinutesLabel}</Text>
      <Text style={styles.helper}>{card.reassurance}</Text>
    </View>
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
    tierBadge: {
      backgroundColor: t.background.surfaceInset,
      borderRadius: 14,
      color: t.text.primary,
      fontSize: 12,
      fontWeight: '900',
      overflow: 'hidden',
      paddingHorizontal: 9,
      paddingVertical: 6
    },
    goalBadge: {
      backgroundColor: t.background.surfaceInset,
      borderRadius: 14,
      color: t.text.secondary,
      fontSize: 12,
      fontWeight: '900',
      overflow: 'hidden',
      paddingHorizontal: 9,
      paddingVertical: 6
    },
    xpTotal: {
      color: t.text.primary,
      fontSize: 28,
      fontWeight: '900',
      letterSpacing: -0.6,
      lineHeight: 34,
      marginTop: 10
    },
    levelDetail: { color: t.text.secondary, fontSize: 13, lineHeight: 19, marginTop: 4 },
    pipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
    pip: { borderRadius: 7, height: 14, width: 14 },
    pipActive: { backgroundColor: t.status.success },
    pipInactive: {
      backgroundColor: t.background.surfaceInset,
      borderColor: t.border.subtle,
      borderWidth: 1
    },
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
