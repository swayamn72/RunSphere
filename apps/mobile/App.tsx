import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useReducer, useState } from 'react';
import { SafeAreaView, Text, View } from 'react-native';
import { activityQueue } from './src/activity-queue.native';
import { accountScopeFor, legacyAccountScopesFor } from './src/account-scope';
import { activityRecorder } from './src/activity-recorder.native';
import type { ActivitySession, MovementType } from './src/activity-recorder-core';
import type { QuestSummary } from '@runsphere/contracts';
import type { AuthSession } from './src/auth-storage-core';
import { createActivitySyncCoordinator } from './src/activity-sync';
import { MobileApiClient } from './src/api-client';
import { authStorage } from './src/auth-storage.native';
import { FocusedFlexShell, FocusedScrollShell, TabScrollShell } from './src/components/ScreenShell';
import { PrimaryButton } from './src/components/primitives';
import { useAppStyles } from './src/components/styles';
import { coordinateLogout } from './src/logout-coordinator';
import { TabBar } from './src/navigation/TabBar';
import { isTabBarVisible, selectAppShell } from './src/navigation/app-shell';
import {
  activityFlowReducer,
  activityOriginReturn,
  initialActivityRoute,
  routeOrigin
} from './src/activity-flow';
import type { Tab } from './src/navigation/types';
import { initialOnboardingState, onboardingReducer } from './src/onboarding';
import {
  ActivityHistory,
  ActivityPreparation,
  ActivityRecording
} from './src/screens/ActivityScreens';
import { Onboarding } from './src/screens/OnboardingScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { ClubsScreen, ProfileScreen } from './src/screens/ProductScreens';
import { PlayScreen } from './src/screens/PlayScreen';
import { ExploreScreen } from './src/screens/ExploreScreen';
import { QuestDetailScreen } from './src/screens/QuestDetailScreen';
import { ThemeProvider, useAppTheme } from './src/theme/theme';

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
  const [activeTab, setActiveTab] = useState<Tab>('Home');
  const [activityRoute, dispatchActivityRoute] = useReducer(
    activityFlowReducer,
    initialActivityRoute
  );
  const [movement, setMovement] = useState<MovementType>('walk');
  const [recording, setRecording] = useState<ActivitySession>();
  const [accountId, setAccountId] = useState<string>();
  const [initializationState, setInitializationState] = useState<
    'loading' | 'ready' | 'storage-failure'
  >('loading');
  const [selectedQuest, setSelectedQuest] = useState<QuestSummary>();
  const [storageAttempt, retryStorage] = useReducer((attempt: number) => attempt + 1, 0);

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
  }, [storageAttempt]);

  const finishSession = useCallback(() => {
    setActiveTab('Home');
    setSelectedQuest(undefined);
    dispatchActivityRoute({ type: 'logout' });
    setRecording(undefined);
    setAccountId(undefined);
    dispatch({ type: 'logoutComplete' });
  }, []);
  const expireSession = useCallback(() => {
    void coordinateLogout({
      api: apiClient,
      auth: authStorage,
      queue: activityQueue,
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
        onAuthenticated={(session) => setAccountId(accountIdFromSession(session))}
      />
    );

  const openActivity = (origin: 'home' | 'explore' | 'quest-detail') => {
    const capturedOrigin =
      origin === 'quest-detail' && selectedQuest
        ? { kind: 'quest-detail' as const, quest: selectedQuest }
        : { kind: origin === 'home' ? ('home' as const) : ('explore' as const) };
    dispatchActivityRoute({ type: 'start-free', origin: capturedOrigin });
    setSelectedQuest(undefined);
  };
  const exitActivity = () => {
    const origin = routeOrigin(activityRoute);
    dispatchActivityRoute({ type: 'exit' });
    setRecording(undefined);
    if (origin) {
      const destination = activityOriginReturn(origin);
      setActiveTab(destination.activeTab);
      setSelectedQuest(destination.selectedQuest);
    }
  };
  const origin = routeOrigin(activityRoute);
  const originLabel =
    origin?.kind === 'quest-detail'
      ? origin.quest.title
      : origin?.kind === 'explore'
        ? 'Explore'
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
    exploreInteractive:
      activeTab === 'Explore' && !selectedQuest && activityRoute.screen === 'idle' && !recording
  });
  const content =
    recording && accountId ? (
      <ActivityRecording
        session={recording}
        accountId={accountId}
        onChange={(session) => {
          if (session?.state === 'completed-local')
            dispatchActivityRoute({ type: 'recording-finished' });
          setRecording(session);
        }}
        onExit={exitActivity}
        sync={activitySync}
      />
    ) : activityRoute.screen === 'prepare' && accountId ? (
      <ActivityPreparation
        accountId={accountId}
        initialMovement={movement}
        {...(originLabel ? { originLabel } : {})}
        onChange={(session) => {
          dispatchActivityRoute({ type: 'recording-active' });
          setRecording(session);
        }}
        onExit={exitActivity}
      />
    ) : activeTab === 'Home' ? (
      <HomeScreen
        api={apiClient}
        movement={movement}
        onMovementChange={setMovement}
        onStart={() => openActivity('home')}
        onOpenQuests={() => setActiveTab('Explore')}
        onOpenProfile={() => setActiveTab('You')}
        onSessionExpired={expireSession}
      />
    ) : selectedQuest ? (
      <QuestDetailScreen
        api={apiClient}
        quest={selectedQuest}
        onBack={() => setSelectedQuest(undefined)}
        onStart={() => openActivity('quest-detail')}
      />
    ) : activeTab === 'Explore' ? (
      <ExploreScreen
        api={apiClient}
        onSelectQuest={setSelectedQuest}
        onStart={() => openActivity('explore')}
        onSessionExpired={expireSession}
      />
    ) : activeTab === 'Clubs' ? (
      <ClubsScreen />
    ) : activeTab === 'Play' ? (
      <PlayScreen api={apiClient} accountId={accountId} onSessionExpired={expireSession} />
    ) : (
      <>
        {accountId && (
          <ActivityHistory accountId={accountId} sync={activitySync} onOpen={setRecording} />
        )}
        <ProfileScreen api={apiClient} accountId={accountId} onLogoutComplete={finishSession} />
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
            dispatchActivityRoute({ type: 'select-tab' });
            setSelectedQuest(undefined);
            setActiveTab(tab);
          }}
        />
      )}
    </SafeAreaView>
  );
}
