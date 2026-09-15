import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type {
  Profile,
  ProgressionSummary,
  QuestSummary,
  WeeklyGoalResponse
} from '@runsphere/contracts';
import type { MobileApiClient } from '../api-client';
import { LoopCallout } from '../components/LoopCallout';
import { LoopMascot } from '../components/Mascot';
import { useAppStyles } from '../components/styles';
import { useLoopGuidance } from '../components/useLoopGuidance';
import type { LoopGuidanceCue } from '../loop-guidance';
import { useAppTheme } from '../theme/theme';
import {
  ActiveDaysCard,
  DashboardGrid,
  HomeHeader,
  QuickActions,
  TodaysChallengeCard
} from './HomeDashboard';
import {
  activeDaysPresentation,
  dashboardTiles,
  greetingPresentation
} from './home-dashboard-model';
import {
  homeErrorState,
  homeStatusMessage,
  questDistanceLabel,
  questListState,
  type HomeRemoteState,
  weeklyGoalMetrics,
  weeklyGoalState
} from './home-state';
import { unreadBadgeLabel, unreadIds } from './notifications-model';
import {
  progressionCardState,
  progressionErrorState,
  progressionStatusMessage,
  type ProgressionCardState
} from './home-progression-model';

interface HomeRemoteData {
  /** Unread inbox entries, for the header's marker. */
  readonly unreadCount: number;
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
  /**
   * Unread notices, for the bell's marker only.
   *
   * A failure leaves the count at zero rather than showing a badge nobody can
   * explain: the inbox itself is the record, and Home's dot is a hint about it.
   */
  const [unreadCount, setUnreadCount] = useState(0);
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
    // The greeting's name and monogram come from here. A missing profile
    // answers `404`, so a failure must leave the greeting neutral rather than
    // block the dashboard or invent an identity.
    void api
      .getProfile()
      .then((next) => {
        if (!mounted.current || generation !== progressionGeneration.current) return;
        setProfile(next);
      })
      .catch(() => undefined);
    void api
      .getNotificationInbox()
      .then((entries) => {
        if (!mounted.current || generation !== progressionGeneration.current) return;
        setUnreadCount(unreadIds(entries).length);
      })
      .catch(() => {
        if (mounted.current && generation === progressionGeneration.current) setUnreadCount(0);
      });
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
    unreadCount,
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
  onStart,
  onChooseRoute,
  onOpenChallenges,
  onOpenQuests,
  onOpenMap,
  onOpenSocial,
  onOpenNotifications,
  onOpenProfile,
  onSessionExpired
}: {
  api: MobileApiClient;
  onStart: () => void;
  /** "Choose a route instead" (`screens.md` 2.1) - secondary to starting. */
  onChooseRoute: () => void;
  onOpenChallenges: () => void;
  onOpenQuests: () => void;
  onOpenMap: () => void;
  onOpenSocial: () => void;
  onOpenNotifications: () => void;
  onOpenProfile: () => void;
  onSessionExpired: () => void;
}) {
  const styles = useAppStyles();
  const { tokens } = useAppTheme();
  const local = useMemo(() => createStyles(tokens), [tokens]);
  const {
    unreadCount,
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
  const featured = metrics[0];
  const greeting = greetingPresentation(profile, new Date().getHours());
  const activeDays = activeDaysPresentation(progression);
  const unreadLabel = unreadBadgeLabel(unreadCount);
  const tiles = dashboardTiles(goal, progression);
  const statusMessage = homeStatusMessage(
    goalState,
    questState,
    progressionStatusMessage(progressionState)
  );

  // Home offers one cue: a week boundary the reader has actually crossed. The
  // hook drops it on a first run, when there is no earlier week to have reset.
  const guidanceCandidates = useMemo<readonly LoopGuidanceCue[]>(() => ['weekly-reset'], []);
  const guidance = useLoopGuidance(guidanceCandidates, { week: goal?.weekStartsOn });

  return (
    <>
      <Text accessibilityLiveRegion="polite" style={styles.visuallyHidden}>
        {statusMessage}
      </Text>

      <HomeHeader
        greeting={greeting}
        {...(unreadLabel ? { unreadLabel } : {})}
        onOpenNotifications={onOpenNotifications}
        onOpenProfile={onOpenProfile}
      />

      {guidance.cue && <LoopCallout cue={guidance.cue} onDismiss={guidance.dismiss} />}

      {/* The active-days meter stands in for the streak the design shows: the
          server reports a weekly count, and there is no consecutive-day figure
          anywhere in the API to count a streak from. */}
      {activeDays ? (
        <ActiveDaysCard card={activeDays} />
      ) : (
        progressionState === 'loading' && <View style={[local.skeleton, local.skeletonCard]} />
      )}

      <DashboardGrid tiles={tiles} />
      {goalState === 'loading' && !tiles.length && (
        <View style={styles.statGrid}>
          <View style={[local.skeleton, local.skeletonTile]} />
          <View style={[local.skeleton, local.skeletonTile]} />
        </View>
      )}

      {/* The design's "Today's Challenge". Titled for what the number actually
          is - a weekly goal the server is tracking - because Home has no
          per-day challenge to read, and a challenge mid-window has no score
          until the worker closes it (`play-model`). */}
      {featured && (
        <TodaysChallengeCard
          title="This week's goal"
          detail={`${featured.label}: ${featured.actual} of ${featured.goal}`}
          progress={featured.progress}
          progressLabel={`${featured.actual} / ${featured.goal}`}
          onPress={onOpenChallenges}
        />
      )}
      {goalState === 'empty' && (
        <Guide
          local={local}
          styles={styles}
          variant="empty"
          label="Choose a distance or active-minute goal when you are ready."
          actionLabel="Set weekly goal"
          onAction={onOpenProfile}
        />
      )}
      {goalState === 'offline' && (
        <Guide
          local={local}
          styles={styles}
          variant="offline"
          label="Weekly progress is unavailable offline."
          actionLabel="Try again"
          onAction={reloadGoals}
        />
      )}
      {goalState === 'configuration' && (
        <Unavailable
          local={local}
          styles={styles}
          label="Weekly progress is unavailable until RunSphere is configured."
        />
      )}
      {goalState === 'error' && (
        <Unavailable
          local={local}
          styles={styles}
          label="Weekly progress is unavailable."
          actionLabel="Try again"
          onAction={reloadGoals}
        />
      )}
      {(progressionState === 'offline' || progressionState === 'error') && (
        <Unavailable
          local={local}
          styles={styles}
          label={
            progressionState === 'offline'
              ? 'Progression is unavailable offline.'
              : 'Progression is unavailable.'
          }
          actionLabel="Try again"
          onAction={reloadProgression}
        />
      )}

      <QuickActions
        onAction={(action) => {
          if (action === 'run') onStart();
          else if (action === 'map') onOpenMap();
          else onOpenSocial();
        }}
      />

      <Text style={local.privacyNote}>
        A free run records locally first. Exact route, start, and finish stay private.
      </Text>
      <Pressable accessibilityRole="button" onPress={onChooseRoute}>
        <Text style={local.chooseRoute}>Choose a route instead →</Text>
      </Pressable>

      <View style={styles.sectionHeader}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          Verified quests
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Explore verified quests"
          onPress={onOpenQuests}
        >
          <Text style={styles.link}>View all</Text>
        </Pressable>
      </View>
      {questState === 'loading' && (
        <View style={local.questLoading}>
          <LoopMascot variant="loading" accessibility={{ mode: 'decorative' }} size={48} />
          <Text style={styles.muted}>Looking for verified quests.</Text>
        </View>
      )}
      {questState === 'ready' &&
        quests.slice(0, 3).map((quest) => (
          <Pressable
            key={quest.id}
            accessibilityRole="button"
            accessibilityLabel={`Explore ${quest.title}, ${questDistanceLabel(quest.distanceMeters)}`}
            onPress={onOpenQuests}
            style={({ pressed }) => [styles.historyRow, pressed && styles.buttonPressed]}
          >
            <View style={styles.flexCopy}>
              <Text style={styles.rowTitle}>{quest.title}</Text>
              <Text style={styles.rowDetail}>
                {questDistanceLabel(quest.distanceMeters)} · about {quest.estimatedActiveMinutes}{' '}
                min · {quest.accessibility}
              </Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        ))}
      {questState === 'empty' && (
        <Guide
          local={local}
          styles={styles}
          variant="empty"
          label="No verified quests are available right now. You can explore or start a free activity."
          actionLabel="Explore"
          onAction={onOpenQuests}
        />
      )}
      {questState === 'offline' && (
        <Guide
          local={local}
          styles={styles}
          variant="offline"
          label="Verified quests are unavailable offline."
          actionLabel="Try again"
          onAction={reloadQuests}
        />
      )}
      {questState === 'configuration' && (
        <Unavailable
          local={local}
          styles={styles}
          label="Verified quests are unavailable until RunSphere is configured."
        />
      )}
      {questState === 'error' && (
        <Unavailable
          local={local}
          styles={styles}
          label="Verified quests are unavailable."
          actionLabel="Try again"
          onAction={reloadQuests}
        />
      )}
    </>
  );
}

function Guide({
  local,
  styles,
  variant,
  label,
  actionLabel,
  onAction
}: {
  local: ReturnType<typeof createStyles>;
  styles: ReturnType<typeof useAppStyles>;
  variant: 'empty' | 'offline';
  label: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <View style={local.guide}>
      <LoopMascot variant={variant} accessibility={{ mode: 'decorative' }} size={48} />
      <View style={styles.flexCopy}>
        <Text style={styles.muted}>{label}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          onPress={onAction}
          style={local.guideAction}
        >
          <Text style={local.guideActionText}>{actionLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Unavailable({
  local,
  styles,
  label,
  actionLabel,
  onAction
}: {
  local: ReturnType<typeof createStyles>;
  styles: ReturnType<typeof useAppStyles>;
  label: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={local.unavailable}>
      <Text style={styles.muted}>{label}</Text>
      {actionLabel && onAction && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          onPress={onAction}
          style={local.guideAction}
        >
          <Text style={local.guideActionText}>{actionLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

const createStyles = (t: ReturnType<typeof useAppTheme>['tokens']) =>
  StyleSheet.create({
    skeleton: { backgroundColor: t.background.surfaceInset, borderRadius: 18 },
    skeletonCard: { height: 116, marginBottom: 12 },
    skeletonTile: { flexBasis: '46%', flexGrow: 1, height: 86 },
    privacyNote: { color: t.text.secondary, fontSize: 12, lineHeight: 18, marginTop: 16 },
    chooseRoute: {
      color: t.action.primary,
      fontSize: 14,
      fontWeight: '800',
      marginTop: 10,
      paddingVertical: 8
    },
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
    questLoading: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 12,
      marginTop: 12,
      minHeight: 64
    }
  });
