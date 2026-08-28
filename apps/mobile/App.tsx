import { StatusBar } from 'expo-status-bar';
import { useEffect, useReducer, useState } from 'react';
import { SafeAreaView, Text, View } from 'react-native';
import { activityQueue } from './src/activity-queue.native';
import { accountScopeFor, legacyAccountScopesFor } from './src/account-scope';
import { activityRecorder } from './src/activity-recorder.native';
import type { ActivitySession, MovementType } from './src/activity-recorder-core';
import type { AuthSession } from './src/auth-storage-core';
import { createActivitySyncCoordinator } from './src/activity-sync';
import { MobileApiClient } from './src/api-client';
import { authStorage } from './src/auth-storage.native';
import { FocusedFlexShell, FocusedScrollShell, TabScrollShell } from './src/components/ScreenShell';
import { PrimaryButton } from './src/components/primitives';
import { useAppStyles } from './src/components/styles';
import { TabBar } from './src/navigation/TabBar';
import { exitActivityFlow, isTabBarVisible, selectAppShell } from './src/navigation/app-shell';
import type { Tab } from './src/navigation/types';
import { initialOnboardingState, onboardingReducer } from './src/onboarding';
import {
  ActivityHistory,
  ActivityPreparation,
  ActivityRecording
} from './src/screens/ActivityScreens';
import { Onboarding } from './src/screens/OnboardingScreen';
import {
  ClubsScreen,
  HomeScreen,
  ProfileScreen,
  QuestScreen,
  SeasonScreen
} from './src/screens/ProductScreens';
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
  const [activityStarted, setActivityStarted] = useState(false);
  const [movement, setMovement] = useState<MovementType>('walk');
  const [recording, setRecording] = useState<ActivitySession>();
  const [accountId, setAccountId] = useState<string>();
  const [restoring, setRestoring] = useState(true);
  const [storageError, setStorageError] = useState(false);
  const [storageAttempt, retryStorage] = useReducer((attempt: number) => attempt + 1, 0);

  useEffect(() => {
    let mounted = true;
    setRestoring(true);
    setStorageError(false);
    void (async () => {
      try {
        await Promise.all([activityQueue.initialize(), activityRecorder.initialize()]);
        const session = await authStorage.read();
        if (!session) return;
        const scope = accountIdFromSession(session);
        await activityRecorder.rekeyLegacyScopes(scope, legacyAccountScopesFor(session));
        const recovered = await activityRecorder.recover(scope);
        if (!mounted) return;
        setAccountId(scope);
        setRecording(recovered);
        dispatch({ type: 'restoreSession' });
      } catch (error) {
        console.error('Unable to initialize encrypted activity storage', error);
        if (mounted) setStorageError(true);
      } finally {
        if (mounted) setRestoring(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [storageAttempt]);

  if (restoring)
    return <SafeAreaView style={[styles.screen, { backgroundColor: tokens.background.canvas }]} />;
  if (storageError)
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

  const openActivity = () => {
    setActivityStarted(true);
    setActiveTab('Home');
  };
  const exitActivity = () => {
    const next = exitActivityFlow(activeTab);
    setActivityStarted(next.activityStarted);
    setRecording(next.recording);
    setActiveTab(next.activeTab);
  };
  const shell = selectAppShell({
    activityStarted,
    hasRecording: Boolean(recording),
    liveInteractive: false
  });
  const content =
    recording && accountId ? (
      <ActivityRecording
        session={recording}
        accountId={accountId}
        onChange={setRecording}
        onExit={exitActivity}
        sync={activitySync}
      />
    ) : activityStarted && accountId ? (
      <ActivityPreparation
        accountId={accountId}
        initialMovement={movement}
        onChange={setRecording}
        onExit={exitActivity}
      />
    ) : activeTab === 'Home' ? (
      <HomeScreen
        api={apiClient}
        movement={movement}
        onMovementChange={setMovement}
        onStart={openActivity}
        onOpenQuests={() => setActiveTab('Explore')}
        onOpenProfile={() => setActiveTab('You')}
      />
    ) : activeTab === 'Explore' ? (
      <QuestScreen api={apiClient} onStart={openActivity} />
    ) : activeTab === 'Clubs' ? (
      <ClubsScreen />
    ) : activeTab === 'Season' ? (
      <SeasonScreen />
    ) : (
      <>
        {accountId && (
          <ActivityHistory accountId={accountId} sync={activitySync} onOpen={setRecording} />
        )}
        <ProfileScreen
          api={apiClient}
          accountId={accountId}
          onLogoutComplete={() => {
            setActiveTab('Home');
            setActivityStarted(false);
            setRecording(undefined);
            setAccountId(undefined);
            dispatch({ type: 'logoutComplete' });
          }}
        />
      </>
    );

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: tokens.background.canvas }]}>
      <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
      {shell === 'tab-scroll' ? (
        <TabScrollShell>{content}</TabScrollShell>
      ) : shell === 'focused-scroll' ? (
        <FocusedScrollShell>{content}</FocusedScrollShell>
      ) : (
        <FocusedFlexShell>{content}</FocusedFlexShell>
      )}
      {isTabBarVisible(shell) && (
        <TabBar
          activeTab={activeTab}
          onChange={(tab) => {
            setActivityStarted(false);
            setActiveTab(tab);
          }}
        />
      )}
    </SafeAreaView>
  );
}
