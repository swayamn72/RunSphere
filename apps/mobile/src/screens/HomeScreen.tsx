import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { space } from '@runsphere/ui';
import { AppState, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../components/Text';
import type {
  Profile,
  ProgressionSummary,
  QuestSummary,
  TerritoryClaimSummary,
  WeeklyGoalResponse
} from '@runsphere/contracts';
import type { MobileApiClient } from '../api-client';
import { LoopCallout } from '../components/LoopCallout';
import { LoopMascot } from '../components/Mascot';
import { useAppStyles } from '../components/styles';
import { useLoopGuidance } from '../components/useLoopGuidance';
import type { LoopGuidanceCue } from '../loop-guidance';
import {
  dashboardPreviewEnabled,
  previewProgression,
  previewTurfQuests
} from './dashboard-preview';
import { useAppTheme } from '../theme/theme';
import {
  ActiveDaysCard,
  DashboardGrid,
  HomeHeader,
  HomeLinkRow,
  HomeSectionTitle,
  HomeStartButton,
  HomeTurfCard,
  WeeklyGoalCard
} from './HomeDashboard';
import {
  activeDaysPresentation,
  dashboardTiles,
  greetingPresentation
} from './home-dashboard-model';
import {
  homeErrorState,
  homeStatusMessage,
  questListState,
  type HomeRemoteState,
  weeklyGoalMetrics,
  weeklyGoalState
} from './home-state';
import { unreadBadgeLabel, unreadIds } from './notifications-model';
import { TutorialTarget } from '../components/TutorialTarget';
import {
  progressionCardState,
  progressionErrorState,
  progressionStatusMessage,
  type ProgressionCardState
} from './home-progression-model';
import { claimableRunId, formatTurfPoints } from './territory-claim-model';

interface HomeRemoteData {
  /** Unread inbox entries, for the header's marker. */
  readonly unreadCount: number;
  readonly goal: WeeklyGoalResponse | undefined;
  readonly goalState: HomeRemoteState;
  readonly quests: readonly QuestSummary[];
  readonly questState: HomeRemoteState;
  readonly progression: ProgressionSummary | undefined;
  readonly progressionState: ProgressionCardState;
  readonly turf: TerritoryClaimSummary | undefined;
  readonly profile: Profile | undefined;
  readonly reloadGoals: () => void;
  readonly reloadQuests: () => void;
  readonly reloadProgression: () => void;
}

const homePreview = {
  unreadCount: 2,
  goal: {
    weekStartsOn: '2026-11-16',
    activeMinutes: { goal: 120, actual: 78 },
    distanceMeters: { goal: 15_000, actual: 9_400 }
  },
  goalState: 'ready',
  progression: previewProgression,
  progressionState: 'ready',
  turf: { claimCount: 7, totalAreaSqm: 84_000, lostCount: 1 },
  profile: {
    id: '00000000-0000-4000-8000-000000000001',
    displayName: 'Maya Chen',
    cosmetic: { avatarKey: 'loop-1', tier: 'Trailkeeper' },
    activityVisibility: 'private'
  },
  // The same multi-stop sample quests the quest map opens in preview.
  quests: previewTurfQuests,
  questState: 'ready'
} satisfies Omit<HomeRemoteData, 'reloadGoals' | 'reloadQuests' | 'reloadProgression'>;

const useHomeRemoteData = (api: MobileApiClient, onSessionExpired: () => void): HomeRemoteData => {
  const [goal, setGoal] = useState<WeeklyGoalResponse>();
  const [goalState, setGoalState] = useState<HomeRemoteState>('loading');
  const [quests, setQuests] = useState<readonly QuestSummary[]>([]);
  const [questState, setQuestState] = useState<HomeRemoteState>('loading');
  const [progression, setProgression] = useState<ProgressionSummary>();
  const [progressionState, setProgressionState] = useState<ProgressionCardState>('loading');
  const [turf, setTurf] = useState<TerritoryClaimSummary>();
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
    setTurf(undefined);
    void Promise.resolve()
      .then(() => api.getTerritoryClaimSummary())
      .then((next) => {
        if (mounted.current && generation === progressionGeneration.current) setTurf(next);
      })
      .catch(() => undefined);
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
    if (dashboardPreviewEnabled) return;
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

  const data = {
    unreadCount,
    goal,
    goalState,
    quests,
    questState,
    progression,
    progressionState,
    turf,
    profile
  };

  return {
    ...(dashboardPreviewEnabled ? homePreview : data),
    reloadGoals: loadGoals,
    reloadQuests: loadQuests,
    reloadProgression: loadProgression
  };
};

export function HomeScreen({
  api,
  onOpenClaim,
  onStart,
  onOpenChallenges,
  onOpenQuests,
  onSelectQuest,
  onOpenMap,
  onOpenNotifications,
  onOpenProfile,
  onOpenPrivacy,
  onSessionExpired
}: {
  api: MobileApiClient;
  onOpenClaim?: (runId: string) => void;
  onStart: () => void;
  onOpenChallenges: () => void;
  onOpenQuests: () => void;
  onSelectQuest: (quest: QuestSummary) => void;
  onOpenMap: () => void;
  onOpenNotifications: () => void;
  onOpenProfile: () => void;
  /** Opens Privacy & visibility, for the one-time review prompt (ADR-0014). */
  onOpenPrivacy?: () => void;
  onSessionExpired: () => void;
}) {
  const [readyClaim, setReadyClaim] = useState<string>();
  const checksClaims = Boolean(onOpenClaim);
  useEffect(() => {
    if (!checksClaims) return;
    let generation = 0;
    let followUps = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      const request = ++generation;
      clearTimeout(retry);
      try {
        const runs = await api.listActivities();
        if (request !== generation) return;
        const ready = claimableRunId(runs);
        setReadyClaim(ready);
        if (
          !ready &&
          followUps < 8 &&
          runs.some(
            (run) =>
              (run.status === 'received' || run.status === 'validating') &&
              (run.runMode === 'turf' || run.runMode === 'ghost')
          )
        ) {
          followUps += 1;
          retry = setTimeout(() => void refresh(), 15_000);
        }
      } catch {
        if (request === generation) setReadyClaim(undefined);
      }
    };
    void refresh();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        followUps = 0;
        void refresh();
      } else {
        generation += 1;
        clearTimeout(retry);
      }
    });
    return () => {
      generation += 1;
      clearTimeout(retry);
      subscription.remove();
    };
  }, [api, checksClaims]);

  // Accounts from before usernames haven't seen their privacy settings yet.
  // Until they save them once, Home asks them to look (ADR-0014, SI.5).
  const [privacyUnreviewed, setPrivacyUnreviewed] = useState(false);
  useEffect(() => {
    let active = true;
    void api
      .getPrivacySettings()
      .then((settings) => {
        if (active) setPrivacyUnreviewed(!settings.reviewed);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [api]);
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
    turf,
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

      {dashboardPreviewEnabled && <Text style={styles.muted}>Sample dashboard data</Text>}

      {/* The thing a runner does next comes first (component plan 4.2). */}
      <TutorialTarget id="home-start">
        <HomeStartButton onPress={onStart} />
      </TutorialTarget>

      <HomeTurfCard points={turf && formatTurfPoints(turf.totalAreaSqm)} onPress={onOpenMap} />

      <View style={local.panel}>
        <HomeSectionTitle onPaper>This week</HomeSectionTitle>
        <DashboardGrid tiles={dashboardTiles(goal)} />
        {activeDays && <ActiveDaysCard card={activeDays} />}

        {featured && <WeeklyGoalCard metric={featured} onPress={onOpenChallenges} />}
        {goalState === 'empty' && (
          <Guide
            onPaper
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
            onPaper
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
            onPaper
            local={local}
            styles={styles}
            label="Weekly progress isn't available right now. Try again later."
          />
        )}
        {goalState === 'error' && (
          <Unavailable
            onPaper
            local={local}
            styles={styles}
            label="Weekly progress is unavailable."
            actionLabel="Try again"
            onAction={reloadGoals}
          />
        )}
      </View>
      {guidance.cue && <LoopCallout cue={guidance.cue} onDismiss={guidance.dismiss} />}
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

      {privacyUnreviewed && onOpenPrivacy ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Review who can see you"
          onPress={onOpenPrivacy}
          style={[styles.recordCard, local.coachCard]}
        >
          <Text style={styles.eyebrow}>NEW: USERNAMES AND PROFILES</Text>
          <Text style={styles.rowTitle}>Review who can see you</Text>
          <Text style={styles.rowDetail}>
            Friends can now find you by username. Your account starts private; choose what to share.
          </Text>
        </Pressable>
      ) : null}

      {readyClaim && onOpenClaim ? (
        <HomeLinkRow
          icon="map"
          title="Claim your loop"
          detail="Your run is ready to review on the map."
          accessibilityLabel="Claim your loop"
          onPress={() => onOpenClaim(readyClaim)}
        />
      ) : null}

      <View style={local.quests}>
        <TutorialTarget id="home-quests" style={local.questHeader}>
          <HomeSectionTitle>Quests</HomeSectionTitle>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Explore quests"
            onPress={onOpenQuests}
            style={local.viewAll}
          >
            <Text style={local.viewAllText}>View all</Text>
          </Pressable>
        </TutorialTarget>
        {questState === 'loading' && (
          <View style={local.questLoading}>
            <LoopMascot variant="loading" accessibility={{ mode: 'decorative' }} size={48} />
            <Text style={styles.muted}>Looking for quests.</Text>
          </View>
        )}
        {questState === 'ready' &&
          quests
            .slice(0, 3)
            .map((quest) => (
              <HomeLinkRow
                key={quest.id}
                icon="flag"
                title={quest.title}
                questImage
                onPress={() => onSelectQuest(quest)}
              />
            ))}
        {questState === 'empty' && (
          <Guide
            local={local}
            styles={styles}
            variant="empty"
            label="No quests are available right now. You can explore or start a free activity."
            actionLabel="Explore"
            onAction={onOpenQuests}
          />
        )}
        {questState === 'offline' && (
          <Guide
            local={local}
            styles={styles}
            variant="offline"
            label="Quests are unavailable offline."
            actionLabel="Try again"
            onAction={reloadQuests}
          />
        )}
        {questState === 'configuration' && (
          <Unavailable
            local={local}
            styles={styles}
            label="Quests aren't available right now. Try again later."
          />
        )}
        {questState === 'error' && (
          <Unavailable
            local={local}
            styles={styles}
            label="Quests are unavailable."
            actionLabel="Try again"
            onAction={reloadQuests}
          />
        )}
      </View>
    </>
  );
}

function Guide({
  local,
  styles,
  onPaper = false,
  variant,
  label,
  actionLabel,
  onAction
}: {
  local: ReturnType<typeof createStyles>;
  styles: ReturnType<typeof useAppStyles>;
  onPaper?: boolean;
  variant: 'empty' | 'offline';
  label: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <View style={local.guide}>
      <LoopMascot variant={variant} accessibility={{ mode: 'decorative' }} size={48} />
      <View style={styles.flexCopy}>
        <Text style={[styles.muted, onPaper && local.paperCopy]}>{label}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          onPress={onAction}
          style={local.guideAction}
        >
          <Text style={[local.guideActionText, onPaper && local.paperAction]}>{actionLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Unavailable({
  local,
  styles,
  onPaper = false,
  label,
  actionLabel,
  onAction
}: {
  local: ReturnType<typeof createStyles>;
  styles: ReturnType<typeof useAppStyles>;
  onPaper?: boolean;
  label: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={local.unavailable}>
      <Text style={[styles.muted, onPaper && local.paperCopy]}>{label}</Text>
      {actionLabel && onAction && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          onPress={onAction}
          style={local.guideAction}
        >
          <Text style={[local.guideActionText, onPaper && local.paperAction]}>{actionLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

const createStyles = (t: ReturnType<typeof useAppTheme>['tokens']) =>
  StyleSheet.create({
    coachCard: { borderLeftColor: t.zone.owned, borderLeftWidth: 3, gap: space.md },
    panel: {
      backgroundColor: t.background.paper,
      borderColor: t.border.paper,
      borderWidth: 1,
      borderRadius: 18,
      marginTop: 14,
      padding: space.md
    },
    paperCopy: { color: t.text.onPaperMuted },
    paperAction: { color: t.text.onPaper, textDecorationLine: 'underline' },
    quests: { marginTop: space.lg },
    questHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: space.sm
    },
    viewAll: {
      borderColor: t.text.secondary,
      borderRadius: 10,
      borderWidth: 1,
      justifyContent: 'center',
      minHeight: 44,
      paddingHorizontal: space.md
    },
    viewAllText: { color: t.text.primary, fontSize: 14, fontWeight: '700' },
    guide: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: space.md,
      marginTop: space.md,
      minHeight: 64
    },
    guideAction: {
      alignSelf: 'flex-start',
      justifyContent: 'center',
      marginTop: space.sm,
      minHeight: 48,
      paddingHorizontal: space.xs
    },
    guideActionText: { color: t.text.accent, fontSize: 14, fontWeight: '700' },
    unavailable: { marginTop: space.md, minHeight: 64 },
    questLoading: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: space.md,
      marginTop: space.md,
      minHeight: 64
    }
  });
