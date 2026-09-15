import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useReducer, useState } from 'react';
import { SafeAreaView, Text, View } from 'react-native';
import { activityQueue } from './src/activity-queue.native';
import { accountScopeFor, legacyAccountScopesFor } from './src/account-scope';
import { activityRecorder } from './src/activity-recorder.native';
import type { ActivitySession } from './src/activity-recorder-core';
import type { QuestSummary } from '@runsphere/contracts';
import type { AuthSession } from './src/auth-storage-core';
import { createActivitySyncCoordinator } from './src/activity-sync';
import { MobileApiClient } from './src/api-client';
import { authStorage } from './src/auth-storage.native';
import { FocusedFlexShell, FocusedScrollShell, TabScrollShell } from './src/components/ScreenShell';
import { PrimaryButton } from './src/components/primitives';
import { useAppStyles } from './src/components/styles';
import { coordinateLogout } from './src/logout-coordinator';
import { setGuidanceStore } from './src/loop-guidance';
import { persistentGuidanceStore } from './src/loop-guidance.native';
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
import type { RouteGuide } from './src/screens/route-preview-model';
import type { GhostRun } from './src/screens/ghost-race-model';
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
const apiClient = new MobileApiClient(undefined, fetch, authStorage);
const activitySync = createActivitySyncCoordinator(apiClient, activityRecorder);
const accountIdFromSession = (session: AuthSession): string => accountScopeFor(session);

export default function App() {
  return (
    <ThemeProvider>
      <RunSphereApp />
    </ThemeProvider>
  );
}

function RunSphereApp() {
  const { colorScheme, tokens } = useAppTheme();
  const styles = useAppStyles();
  const [onboarding, dispatch] = useReducer(onboardingReducer, initialOnboardingState);
  const [activeTab, setActiveTab] = useState<Tab>(landingTab);
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
  /**
   * A ghost being raced. Held here for the same reason as the route guide: it
   * belongs to one run, and nothing about a saved activity depends on whether
   * a ghost was on screen while it was recorded.
   */
  const [ghostRun, setGhostRun] = useState<GhostRun>();
  // Which Social sub-screen to land on. A friend-request notice on Profile has
  // to be able to reach the friends list, which lives under Social.
  const [socialEntry, setSocialEntry] = useState<'feed' | 'friends'>('feed');
  /**
   * Which Profile sub-screen to land on. The dashboard's bell opens the inbox
   * directly; every other route into Profile starts at the profile itself.
   */
  const [profileEntry, setProfileEntry] = useState<'profile' | 'notifications'>('profile');
  const [storageAttempt, retryStorage] = useReducer((attempt: number) => attempt + 1, 0);

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
    setGhostRun(undefined);
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
  if (initializationState === 'loading')
    return <SafeAreaView style={[styles.screen, { backgroundColor: tokens.background.canvas }]} />;
  if (initializationState === 'storage-failure')
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: tokens.background.canvas }]}>
        <View style={styles.loading}>
          <Text style={styles.onboardingTitle}>Secure storage unavailable</Text>
          <Text style={styles.lead}>
            RunSphere could not unlock encrypted activity data. Recording stays disabled to protect
            your local data.
          </Text>
          <PrimaryButton label="Try again" onPress={retryStorage} />
        </View>
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

  const openActivity = (origin: 'home' | 'quests' | 'map' | 'quest-detail') => {
    const capturedOrigin =
      origin === 'quest-detail' && selectedQuest
        ? { kind: 'quest-detail' as const, quest: selectedQuest }
        : { kind: origin as 'home' | 'quests' | 'map' };
    dispatchActivityRoute({ type: 'start-free', origin: capturedOrigin });
    setSelectedQuest(undefined);
  };
  const exitActivity = () => {
    const origin = routeOrigin(activityRoute);
    dispatchActivityRoute({ type: 'exit' });
    setRecording(undefined);
    setRouteGuide(undefined);
    setGhostRun(undefined);
    if (origin) {
      const destination = activityOriginReturn(origin);
      setActiveTab(destination.activeTab);
      setFocus(destination.focus);
      setSelectedQuest(destination.selectedQuest);
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
        {...(ghostRun ? { ghost: ghostRun } : {})}
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
    ) : activityRoute.screen === 'prepare' && accountId ? (
      <ActivityPreparation
        accountId={accountId}
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
        onUseRoute={(guide) => {
          setRouteGuide(guide);
          setFocus('none');
          openActivity('home');
        }}
        onStartWithout={() => {
          // Not a decline: passing on a route today is not rejecting one.
          setRouteGuide(undefined);
          setFocus('none');
          openActivity('home');
        }}
        onBack={() => setFocus('none')}
        onSessionExpired={expireSession}
      />
    ) : selectedQuest ? (
      <QuestDetailScreen
        api={apiClient}
        quest={selectedQuest}
        onBack={() => setSelectedQuest(undefined)}
        onStart={() => openActivity('quest-detail')}
      />
    ) : focus === 'quests' ? (
      <ExploreScreen
        api={apiClient}
        onSelectQuest={setSelectedQuest}
        onStart={() => openActivity('quests')}
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
        api={apiClient}
        onStart={() => openActivity('home')}
        onChooseRoute={() => {
          setRouteGuide(undefined);
          setFocus('route-preview');
        }}
        onOpenChallenges={() => setFocus('challenges')}
        onOpenQuests={() => setFocus('quests')}
        onOpenMap={() => setActiveTab('Map')}
        onOpenSocial={() => {
          setSocialEntry('friends');
          setActiveTab('Social');
        }}
        onOpenNotifications={() => {
          setProfileEntry('notifications');
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
        onOpenRun={() => openActivity('map')}
        onGhostRace={(run) => {
          setGhostRun(run);
          // A ghost is a reference on the map, not a route to follow, so it
          // does not also set a route guide.
          setRouteGuide(undefined);
          openActivity('map');
        }}
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
    <SafeAreaView style={[styles.screen, { backgroundColor: tokens.background.canvas }]}>
      <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
      {shell === 'tab-scroll' ? (
        <TabScrollShell>{content}</TabScrollShell>
      ) : shell === 'tab-map' ? (
        <FocusedFlexShell>{content}</FocusedFlexShell>
      ) : shell === 'focused-scroll' ? (
        <FocusedScrollShell>{content}</FocusedScrollShell>
      ) : (
        <FocusedFlexShell>{content}</FocusedFlexShell>
      )}
      {isTabBarVisible(shell) && (
        <TabBar
          activeTab={activeTab}
          onChange={(tab) => {
            setSelectedQuest(undefined);
            setFocus('none');
            setRouteGuide(undefined);
            setGhostRun(undefined);
            if (tab !== 'Social') setSocialEntry('feed');
            if (tab !== 'Profile') setProfileEntry('profile');
            // Run is an action, not a place: it opens preparation over the tab
            // the reader was already on, so finishing the run returns them
            // there rather than stranding them on an empty Run tab. The map is
            // the one other tab with a return of its own — somebody who just
            // ran a loop for a claim wants to see the claim.
            if (tab === 'Run') {
              openActivity(activeTab === 'Map' ? 'map' : 'home');
              return;
            }
            dispatchActivityRoute({ type: 'select-tab' });
            setActiveTab(tab);
          }}
        />
      )}
    </SafeAreaView>
  );
}
