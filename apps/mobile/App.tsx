import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { activityQueue } from './src/activity-queue.native';
import { accountScopeFor, legacyAccountScopesFor } from './src/account-scope';
import { activityRecorder } from './src/activity-recorder.native';
import type { ActivitySession } from './src/activity-recorder-core';
import type { QuestDetail, QuestSummary } from '@runsphere/contracts';
import type { AuthSession } from './src/auth-storage-core';
import { createActivitySyncCoordinator } from './src/activity-sync';
import { MobileApiClient } from './src/api-client';
import { authStorage } from './src/auth-storage.native';

import type * as BackgroundFetchModule from 'expo-background-fetch';
import type * as TaskManagerModule from 'expo-task-manager';

/**
 * Background sync's native modules, loaded defensively. A build without them
 * must still start (sync then happens only in the foreground) rather than
 * crash at module load, and `TaskManager.defineTask` has to run synchronously
 * at module scope, so neither a static import nor `import()` fits. The types
 * come from the type-only imports above.
 */
const loadBackgroundModules = (): {
  BackgroundFetch: typeof BackgroundFetchModule | null;
  TaskManager: typeof TaskManagerModule | null;
} => {
  try {
    return {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- optional native module, see above
      BackgroundFetch: require('expo-background-fetch') as typeof BackgroundFetchModule,
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- optional native module, see above
      TaskManager: require('expo-task-manager') as typeof TaskManagerModule
    };
  } catch {
    return { BackgroundFetch: null, TaskManager: null };
  }
};
const { BackgroundFetch, TaskManager } = loadBackgroundModules();

import { FocusedFlexShell, FocusedScrollShell, TabScrollShell } from './src/components/ScreenShell';
import { ScreenProgression } from './src/components/ProgressionBadge';
import type { LocationObject } from 'expo-location';
import {
  RUN_LOCATION_TASK,
  markRunLocationTaskReady,
  publishRunLocations
} from './src/location-adapter';
import { inviteTokenFromUrl } from './src/invite-link';
import { InviteAcceptSheet } from './src/screens/InviteAcceptSheet';
import { RunsSharingPrompt } from './src/screens/RunsSharingPrompt';
import { RunDetailProvider } from './src/screens/RunDetailHost';
import { RunDetailScreen } from './src/screens/RunDetailScreen';
import { needsRunsPrompt } from './src/screens/runs-sharing-prompt-model';
import { PrimaryButton } from './src/components/primitives';
import { useAppStyles } from './src/components/styles';
import { coordinateLogout } from './src/logout-coordinator';
import { setGuidanceStore } from './src/loop-guidance';
import { persistentGuidanceStore } from './src/loop-guidance.native';
import {
  setTourStore,
  shouldStartTour,
  tourReducer,
  tourStore,
  type TourAction,
  type TourState
} from './src/tutorial-model';
import { TutorialOverlay } from './src/components/TutorialOverlay';
import { BlurTargetView } from 'expo-blur';
import { persistentTourStore } from './src/tour-secure-store.native';
import { registerForPush, revokePushRegistration } from './src/push-registration';
import { nativePushTokenSource, pushRegistrationStore } from './src/push-registration.native';
import { TabBar } from './src/navigation/TabBar';
import { isTabBarVisible, selectAppShell } from './src/navigation/app-shell';
import {
  activityFlowReducer,
  activityOriginReturn,
  initialActivityRoute,
  routeOrigin,
  type FocusedSurface
} from './src/activity-flow';
import { FREE_RUN, TURF_RUN, type RunStart } from './src/run-start';
import { RunModePicker } from './src/screens/RunModePicker';
import { pickRunMode } from './src/screens/run-mode-model';
import { landingTab, type Tab } from './src/navigation/types';
import { initialOnboardingState, onboardingReducer } from './src/onboarding';
import {
  ActivityHistory,
  ActivityPreparation,
  ActivityRecording
} from './src/screens/ActivityScreens';
import { Onboarding } from './src/screens/OnboardingScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { ProfileScreen } from './src/screens/ProductScreens';
import { PlayScreen } from './src/screens/PlayScreen';
import { ExploreScreen } from './src/screens/ExploreScreen';
import { RoutePreviewScreen } from './src/screens/RoutePreviewScreen';
import type { RouteGuide, RoutePreviewCard } from './src/screens/route-preview-model';
import {
  NOTIFICATION_TARGET_FOCUS,
  NOTIFICATION_TARGET_TAB
} from './src/screens/notifications-model';
import { TurfScreen } from './src/screens/TurfScreen';
import { QuestDetailScreen } from './src/screens/QuestDetailScreen';
import { ThemeProvider, useAppTheme } from './src/theme/theme';

// Guidance memory is resolved through the registry so no screen imports a
// native secure-storage module.
setGuidanceStore(persistentGuidanceStore);
setTourStore(persistentTourStore);
const apiClient = new MobileApiClient(undefined, fetch, authStorage);
const activitySync = createActivitySyncCoordinator(apiClient, activityRecorder);
const accountIdFromSession = (session: AuthSession): string => accountScopeFor(session);

const BACKGROUND_SYNC_TASK = 'background-activity-sync';

if (TaskManager && BackgroundFetch) {
  try {
    TaskManager.defineTask(BACKGROUND_SYNC_TASK, async () => {
      try {
        const session = await authStorage.read();
        if (!session) return BackgroundFetch!.BackgroundFetchResult.NoData;
        const accountId = accountIdFromSession(session);
        const pending = await activitySync.syncPending(accountId);
        if (pending.length > 0) {
          return BackgroundFetch!.BackgroundFetchResult.NewData;
        }
        return BackgroundFetch!.BackgroundFetchResult.NoData;
      } catch (error) {
        console.error('Background sync failed:', error);
        return BackgroundFetch!.BackgroundFetchResult.Failed;
      }
    });
  } catch (error) {
    console.warn('Could not register background sync task:', error);
  }
}

// Screen-off run recording (M8 C.3). Android delivers the foreground service's
// locations here, so the task has to be defined at module scope like the one
// above. Without TaskManager, runs fall back to on-screen recording.
if (TaskManager) {
  try {
    TaskManager.defineTask<{ locations?: LocationObject[] }>(
      RUN_LOCATION_TASK,
      async ({ data, error }) => {
        if (error || !data?.locations) return;
        publishRunLocations(data.locations);
      }
    );
    markRunLocationTaskReady();
  } catch (error) {
    console.warn('Could not register run location task:', error);
  }
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <RunSphereApp />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function RunSphereApp() {
  const { colorScheme, tokens } = useAppTheme();
  const styles = useAppStyles();
  const [onboarding, dispatch] = useReducer(onboardingReducer, initialOnboardingState);
  const [activeTab, setActiveTab] = useState<Tab>(landingTab);
  const [claimRunId, setClaimRunId] = useState<string>();
  useEffect(() => {
    if (activeTab !== 'Map') setClaimRunId(undefined);
  }, [activeTab]);
  const [activityRoute, dispatchActivityRoute] = useReducer(
    activityFlowReducer,
    initialActivityRoute
  );
  const [recording, setRecording] = useState<ActivitySession>();
  const [accountId, setAccountId] = useState<string>();
  const [initializationState, setInitializationState] = useState<
    'loading' | 'ready' | 'storage-failure'
  >('loading');
  const [selectedQuest, setSelectedQuest] = useState<QuestSummary>();
  /**
   * The surface open over the current tab, if any. One value rather than a
   * boolean per screen: the challenge list, the quest catalogue, and the route
   * preview are mutually exclusive, and a pair of booleans could put two of
   * them on screen at once.
   */
  const [focus, setFocus] = useState<FocusedSurface>('none');
  /**
   * An accepted route suggestion, held here rather than on the session: a guide
   * is a reference for one run, and nothing about a saved activity depends on
   * whether one was on screen (`map-ux.md` 1.5).
   */
  const [routeGuide, setRouteGuide] = useState<RouteGuide>();
  const [homeLoop, setHomeLoop] = useState<RoutePreviewCard>();
  /**
   * The stops of the quest a Quest run is for, so the live HUD can tick them
   * off (M9 9.7). Keyed on the session, so a run restored after a restart
   * gets its list back once the app is online.
   */
  const [questRun, setQuestRun] = useState<QuestDetail>();
  const questRunId = recording?.runStart?.mode === 'quest' ? recording.runStart.questId : undefined;
  useEffect(() => {
    setQuestRun(undefined);
    if (!questRunId) return;
    let active = true;
    void apiClient
      .getQuest(questRunId)
      .then((detail) => active && setQuestRun(detail))
      // Offline the HUD just doesn't list the stops; the server still checks them.
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [questRunId]);
  // Which Social sub-screen to land on. A friend-request notice on Profile has
  // to be able to reach the friends list, which lives under Social.
  const [socialEntry, setSocialEntry] = useState<'feed' | 'friends'>('feed');
  /**
   * Which Profile sub-screen to land on. The dashboard's bell opens the inbox
   * directly; every other route into Profile starts at the profile itself.
   */
  const [profileEntry, setProfileEntry] = useState<
    'profile' | 'notifications' | 'settings' | 'privacy'
  >('profile');
  const [storageAttempt, retryStorage] = useReducer((attempt: number) => attempt + 1, 0);
  /**
   * A friend's invite link, opened from outside the app. Kept until the reader
   * is signed in, so a link opened before sign-up still works afterwards.
   */
  const [pendingInvite, setPendingInvite] = useState<string>();
  useEffect(() => {
    const take = (url: string | null) => {
      const token = inviteTokenFromUrl(url);
      if (token) setPendingInvite(token);
    };
    void Linking.getInitialURL()
      .then(take)
      .catch(() => undefined);
    const subscription = Linking.addEventListener('url', (event) => take(event.url));
    return () => subscription.remove();
  }, []);

  /**
   * Register this device for push once an account is known.
   *
   * Best-effort and never awaited by anything the user is waiting on: push is
   * an extra, the durable inbox already holds every notification, and a
   * provider outage must not block sign-in (`push-registration.ts`).
   *
   * This is also where the Android 13+ notification permission is asked for,
   * which `gameplay.md` requires to happen in context — the context being an
   * account that now has an inbox, rather than a cold first launch.
   */
  const claimPushAddress = useCallback(() => {
    void registerForPush({
      api: apiClient,
      source: nativePushTokenSource,
      store: pushRegistrationStore
    });
  }, []);

  useEffect(() => {
    let mounted = true;
    setInitializationState('loading');
    void (async () => {
      try {
        await Promise.all([activityQueue.initialize(), activityRecorder.initialize()]);

        if (BackgroundFetch) {
          try {
            const status = await BackgroundFetch.getStatusAsync();
            if (
              status === BackgroundFetch.BackgroundFetchStatus.Available ||
              status === BackgroundFetch.BackgroundFetchStatus.Restricted
            ) {
              await BackgroundFetch.registerTaskAsync(BACKGROUND_SYNC_TASK, {
                minimumInterval: 15 * 60, // 15 minutes
                stopOnTerminate: false,
                startOnBoot: true
              });
            }
          } catch (error) {
            console.warn('Failed to register background sync task:', error);
          }
        }

        const session = await authStorage.read();
        if (!session) return;
        const scope = accountIdFromSession(session);
        await activityRecorder.rekeyLegacyScopes(scope, legacyAccountScopesFor(session));
        // M1 keeps acquisition in memory; discard only legacy pre-route rows after account scope is known.
        await activityRecorder.discardLegacyPreparation(scope);
        const recovered = await activityRecorder.recoverPaused(scope, new Date().toISOString());
        if (!mounted) return;
        setAccountId(scope);
        // A restored session re-registers: a provider token can be rotated by
        // the OS while the app is closed, and a stale address is a silent hole
        // in delivery rather than an error anybody sees.
        claimPushAddress();
        setRecording(recovered);
        if (recovered)
          dispatchActivityRoute({ type: 'restore-recording', origin: { kind: 'home' } });
        dispatch({ type: 'restoreSession' });
      } catch (error) {
        console.error('Unable to initialize encrypted activity storage', error);
        if (mounted) setInitializationState('storage-failure');
      } finally {
        if (mounted)
          setInitializationState((state) => (state === 'storage-failure' ? state : 'ready'));
      }
    })();
    return () => {
      mounted = false;
    };
  }, [claimPushAddress, storageAttempt]);

  const finishSession = useCallback(() => {
    setActiveTab(landingTab);
    setProfileEntry('profile');
    setSelectedQuest(undefined);
    dispatchActivityRoute({ type: 'logout' });
    setFocus('none');
    setRouteGuide(undefined);
    setHomeLoop(undefined);
    setRecording(undefined);
    setAccountId(undefined);
    dispatch({ type: 'logoutComplete' });
  }, []);
  const expireSession = useCallback(() => {
    void coordinateLogout({
      api: apiClient,
      auth: authStorage,
      queue: activityQueue,
      push: {
        revoke: () => revokePushRegistration({ api: apiClient, store: pushRegistrationStore })
      },
      ...(accountId ? { recorder: { clear: () => activityRecorder.clearAccount(accountId) } } : {})
    }).then(finishSession);
  }, [accountId, finishSession]);
  // "Who sees your runs?" (M9 9.27): once per account, when the legal text it
  // agreed to predates runs being visible. Unknown never blocks the app.
  const [runsPrompt, setRunsPrompt] = useState(false);
  useEffect(() => {
    if (onboarding.step !== 'complete' || !accountId) {
      setRunsPrompt(false);
      return;
    }
    let active = true;
    void needsRunsPrompt(apiClient).then((needed) => {
      if (active) setRunsPrompt(needed);
    });
    return () => {
      active = false;
    };
  }, [onboarding.step, accountId]);
  // The guided tour (M9 9.25): once per account after sign-up, after "Who
  // sees your runs?", and again from Settings.
  const [tour, setTour] = useState<TourState>();
  const tourBlurTarget = useRef<View>(null);
  const [runOpen, setRunOpen] = useState(false);
  useEffect(() => {
    if (onboarding.step !== 'complete' || !accountId || runsPrompt) return;
    let active = true;
    void shouldStartTour(accountId).then((start) => {
      if (active && start) setTour({ index: 0 });
    });
    return () => {
      active = false;
    };
  }, [onboarding.step, accountId, runsPrompt]);
  const tourAction = useCallback(
    (action: TourAction) =>
      setTour((current) => {
        if (!current) return current;
        const next = tourReducer(current, action);
        if (next !== 'done') return next;
        if (accountId) void tourStore().markDone(accountId);
        return undefined;
      }),
    [accountId]
  );
  if (initializationState === 'loading')
    return (
      <SafeAreaView
        edges={['top']}
        style={[styles.screen, { backgroundColor: tokens.background.canvas }]}
      />
    );
  if (initializationState === 'storage-failure')
    return (
      <SafeAreaView
        edges={['top']}
        style={[styles.screen, { backgroundColor: tokens.background.canvas }]}
      >
        <View style={styles.loading}>
          <Text style={styles.onboardingTitle}>Secure storage unavailable</Text>
          <Text style={styles.lead}>
            TURFR could not unlock encrypted activity data. Recording stays disabled to protect your
            local data.
          </Text>
          <PrimaryButton label="Try again" onPress={retryStorage} />
        </View>
      </SafeAreaView>
    );
  if (onboarding.step === 'complete' && pendingInvite && accountId)
    return (
      <SafeAreaView style={styles.screen}>
        <FocusedScrollShell>
          <InviteAcceptSheet
            api={apiClient}
            token={pendingInvite}
            onClose={() => setPendingInvite(undefined)}
          />
        </FocusedScrollShell>
      </SafeAreaView>
    );
  if (onboarding.step === 'complete' && accountId && runsPrompt)
    return (
      <SafeAreaView style={styles.screen}>
        <FocusedScrollShell>
          <RunsSharingPrompt
            api={apiClient}
            onDone={() => setRunsPrompt(false)}
            onSignOut={expireSession}
          />
        </FocusedScrollShell>
      </SafeAreaView>
    );
  if (onboarding.step !== 'complete')
    return (
      <Onboarding
        state={onboarding}
        dispatch={dispatch}
        api={apiClient}
        onAuthenticated={(session) => {
          setAccountId(accountIdFromSession(session));
          claimPushAddress();
        }}
      />
    );

  /**
   * Open the prepare screen for a run in the given mode (M9 9.5). Most starts
   * go through the picker (`chooseRun`); the ones that skip it already say
   * what the run is for. "Run here" on the map and a suggested loop are Turf
   * runs, and a quest's Start is a quest run.
   */
  const openActivity = (
    origin: 'home' | 'quests' | 'map' | 'quest-detail',
    start: RunStart = TURF_RUN
  ) => {
    const capturedOrigin =
      origin === 'quest-detail' && selectedQuest
        ? { kind: 'quest-detail' as const, quest: selectedQuest }
        : { kind: origin as 'home' | 'quests' | 'map' };
    dispatchActivityRoute({ type: 'start-run', origin: capturedOrigin, start });
    setSelectedQuest(undefined);
    setActiveTab('Run');
  };
  /** The Run tab's mode picker (M9 9.6), opened by Home's Start and the Run tab. */
  const chooseRun = (origin: 'home' | 'map') => {
    dispatchActivityRoute({ type: 'choose-mode', origin: { kind: origin } });
    setSelectedQuest(undefined);
    setActiveTab('Run');
  };
  const exitActivity = () => {
    const origin = routeOrigin(activityRoute);
    dispatchActivityRoute({ type: 'exit' });
    setRecording(undefined);
    setRouteGuide(undefined);
    if (origin) {
      const destination = activityOriginReturn(origin);
      setActiveTab(destination.activeTab);
      setFocus(destination.focus);
      setSelectedQuest(destination.selectedQuest);
    } else {
      setActiveTab('Home');
    }
  };
  const origin = routeOrigin(activityRoute);
  const originLabel =
    origin?.kind === 'quest-detail'
      ? origin.quest.title
      : origin?.kind === 'quests'
        ? 'Quests'
        : origin?.kind === 'map'
          ? 'Map'
          : origin?.kind === 'home'
            ? 'Home'
            : undefined;
  const shell = selectAppShell({
    activityRoute: activityRoute.screen,
    hasRecording: Boolean(recording),
    hasSelectedQuest: Boolean(selectedQuest),
    liveInteractive: Boolean(
      recording && ['active', 'resumed', 'paused'].includes(recording.state)
    ),
    focus,
    mapInteractive:
      activeTab === 'Map' &&
      !selectedQuest &&
      focus === 'none' &&
      activityRoute.screen === 'idle' &&
      !recording
  });
  const content =
    recording && accountId ? (
      <ActivityRecording
        session={recording}
        accountId={accountId}
        {...(routeGuide ? { guide: routeGuide } : {})}
        {...(questRun ? { quest: questRun } : {})}
        onOpenMap={(runId) => {
          exitActivity();
          setClaimRunId(runId);
          setActiveTab('Map');
          setFocus('none');
        }}
        onChange={(session) => {
          if (session?.state === 'completed-local') {
            dispatchActivityRoute({ type: 'recording-finished' });
            // `product.md`: the engine learns from completed runs. Best effort
            // and never blocking - a lost event costs a ranking hint, and the
            // run is already saved locally either way.
            if (routeGuide)
              void apiClient
                .sendRouteSuggestionFeedback(routeGuide.routeId, 'completed')
                .catch(() => undefined);
          }
          setRecording(session);
        }}
        onExit={exitActivity}
        sync={activitySync}
      />
    ) : (activityRoute.screen === 'choose' ||
        (activeTab === 'Run' && activityRoute.screen === 'idle')) &&
      accountId ? (
      <RunModePicker
        onBrowseRoutes={() => {
          dispatchActivityRoute({ type: 'exit' });
          setRouteGuide(undefined);
          setFocus('route-preview');
        }}
        onPick={(mode) => {
          const pick = pickRunMode(mode);
          const from = routeOrigin(activityRoute) ?? { kind: 'home' as const };
          if (pick.kind === 'start') {
            dispatchActivityRoute({ type: 'start-run', origin: from, start: pick.start });
            return;
          }
          dispatchActivityRoute({ type: 'exit' });
          // A quest's own Start begins the quest run once it's taken on.
          setActiveTab('Home');
          setFocus('quests');
        }}
      />
    ) : activityRoute.screen === 'prepare' && accountId ? (
      <ActivityPreparation
        accountId={accountId}
        start={activityRoute.start}
        {...(activityRoute.origin.kind === 'quest-detail'
          ? { questTitle: activityRoute.origin.quest.title }
          : {})}
        {...(originLabel ? { originLabel } : {})}
        {...(routeGuide ? { guide: routeGuide } : {})}
        onChange={(session) => {
          dispatchActivityRoute({ type: 'recording-active' });
          setRecording(session);
        }}
        onExit={exitActivity}
      />
    ) : focus === 'route-preview' ? (
      <RoutePreviewScreen
        api={apiClient}
        {...(homeLoop ? { preferredRouteId: homeLoop.suggestion.id } : {})}
        onPreviewChange={setHomeLoop}
        onUseRoute={(guide) => {
          setRouteGuide(guide);
          setFocus('none');
          openActivity('home');
        }}
        onStartWithout={() => {
          // Not a decline: passing on a route today is not rejecting one.
          setRouteGuide(undefined);
          setFocus('none');
          chooseRun('home');
        }}
        onBack={() => setFocus('none')}
        onSessionExpired={expireSession}
      />
    ) : selectedQuest ? (
      <QuestDetailScreen
        api={apiClient}
        quest={selectedQuest}
        onBack={() => setSelectedQuest(undefined)}
        onStart={(start) => openActivity('quest-detail', start)}
      />
    ) : focus === 'quests' ? (
      <ExploreScreen
        api={apiClient}
        onSelectQuest={setSelectedQuest}
        onStart={() => openActivity('quests', FREE_RUN)}
        onBack={() => setFocus('none')}
        onSessionExpired={expireSession}
      />
    ) : focus === 'challenges' ? (
      <PlayScreen
        api={apiClient}
        accountId={accountId}
        initialScreen="play"
        onBack={() => setFocus('none')}
        onSessionExpired={expireSession}
      />
    ) : activeTab === 'Home' ? (
      <HomeScreen
        onOpenClaim={(runId) => {
          setClaimRunId(runId);
          setActiveTab('Map');
        }}
        api={apiClient}
        onStart={() => chooseRun('home')}
        onOpenChallenges={() => setFocus('challenges')}
        onOpenQuests={() => setFocus('quests')}
        onSelectQuest={setSelectedQuest}
        onOpenMap={() => setActiveTab('Map')}
        onOpenNotifications={() => {
          setProfileEntry('notifications');
          setActiveTab('Profile');
        }}
        onOpenPrivacy={() => {
          setProfileEntry('privacy');
          setActiveTab('Profile');
        }}
        onOpenProfile={() => {
          setProfileEntry('profile');
          setActiveTab('Profile');
        }}
        onSessionExpired={expireSession}
      />
    ) : activeTab === 'Map' ? (
      <TurfScreen
        api={apiClient}
        {...(claimRunId ? { requestedRunId: claimRunId } : {})}
        {...(accountId ? { accountId } : {})}
        onOpenRun={() => openActivity('map')}
        onOpenQuest={setSelectedQuest}
        onOpenProfile={() => {
          setProfileEntry('profile');
          setActiveTab('Profile');
        }}
        onOpenSettings={() => {
          setProfileEntry('settings');
          setActiveTab('Profile');
        }}
        onSessionExpired={expireSession}
      />
    ) : activeTab === 'Social' ? (
      <PlayScreen
        key={socialEntry}
        api={apiClient}
        accountId={accountId}
        initialScreen={socialEntry === 'friends' ? 'friends' : 'social'}
        onSessionExpired={expireSession}
      />
    ) : (
      <>
        <ProfileScreen
          key={profileEntry}
          api={apiClient}
          accountId={accountId}
          initialScreen={profileEntry}
          onLogoutComplete={finishSession}
          onReplayTour={() => setTour({ index: 0 })}
          onNavigate={(target) => {
            // Friend requests open the friends list inside Social; challenges
            // and quests open over Home (`NOTIFICATION_TARGET_FOCUS`).
            setSocialEntry(target === 'friends' ? 'friends' : 'feed');
            setFocus(NOTIFICATION_TARGET_FOCUS[target]);
            setActiveTab(NOTIFICATION_TARGET_TAB[target]);
          }}
        />
        {accountId && (
          <ActivityHistory accountId={accountId} sync={activitySync} onOpen={setRecording} />
        )}
      </>
    );

  return (
    <SafeAreaView edges={['top']} style={styles.screen}>
      <RunDetailProvider
        renderDetail={(props) => (
          <RunDetailScreen
            {...props}
            api={apiClient}
            status={
              accountId && (
                <ScreenProgression
                  key={accountId}
                  api={apiClient}
                  refreshKey="run-detail"
                  inHeader
                />
              )
            }
          />
        )}
        onOpenChange={setRunOpen}
      >
        <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
        {/* What the tour's panels blur on Android (M9 9.23). */}
        <BlurTargetView
          ref={tourBlurTarget}
          style={styles.screen}
          // Android has no accessibilityViewIsModal: hide the app from
          // TalkBack while the tour is over it (found on a phone, M9 9.29).
          importantForAccessibility={tour || runOpen ? 'no-hide-descendants' : 'auto'}
        >
          {accountId && content.type !== HomeScreen && content.type !== TurfScreen && (
            <ScreenProgression
              key={accountId}
              api={apiClient}
              refreshKey={`${activeTab}:${focus}:${activityRoute.screen}:${recording?.state ?? ''}`}
            />
          )}
          {shell === 'tab-scroll' ? (
            <TabScrollShell>{content}</TabScrollShell>
          ) : shell === 'tab-map' ? (
            <FocusedFlexShell fullBleed>{content}</FocusedFlexShell>
          ) : shell === 'focused-scroll' ? (
            <FocusedScrollShell>{content}</FocusedScrollShell>
          ) : (
            <FocusedFlexShell>{content}</FocusedFlexShell>
          )}
          {isTabBarVisible(shell) && (
            <TabBar
              activeTab={activeTab}
              turf={shell === 'tab-map'}
              onChange={(tab) => {
                setSelectedQuest(undefined);
                setFocus('none');
                setRouteGuide(undefined);
                if (tab !== 'Social') setSocialEntry('feed');
                if (tab !== 'Profile') setProfileEntry('profile');
                if (tab === 'Run') {
                  if (activeTab !== 'Run') chooseRun(activeTab === 'Map' ? 'map' : 'home');
                  return;
                }
                dispatchActivityRoute({ type: 'select-tab' });
                setActiveTab(tab);
              }}
            />
          )}
        </BlurTargetView>
        {tour ? (
          <TutorialOverlay
            blurTarget={tourBlurTarget}
            state={tour}
            onAction={tourAction}
            activeTab={activeTab}
            onShowTab={(tab) => {
              dispatchActivityRoute({ type: 'select-tab' });
              setActiveTab(tab);
            }}
          />
        ) : null}
      </RunDetailProvider>
    </SafeAreaView>
  );
}
