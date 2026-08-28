import { StatusBar } from 'expo-status-bar';
import { useEffect, useReducer, useState } from 'react';
import { SafeAreaView } from 'react-native';
import { activityQueue } from './src/activity-queue.native';
import { accountScopeFor, legacyAccountScopesFor } from './src/account-scope';
import { activityRecorder } from './src/activity-recorder.native';
import type { ActivitySession, MovementType } from './src/activity-recorder-core';
import { createActivitySyncCoordinator } from './src/activity-sync';
import { MobileApiClient } from './src/api-client';
import { authStorage } from './src/auth-storage.native';
import { styles } from './src/components/styles';
import { TabBar } from './src/navigation/TabBar';
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
  ProductScroll,
  ProfileScreen,
  QuestScreen,
  SeasonScreen
} from './src/screens/ProductScreens';

const apiClient = new MobileApiClient(undefined, fetch, authStorage);
const activitySync = createActivitySyncCoordinator(apiClient, activityRecorder);

export default function App() {
  const [onboarding, dispatch] = useReducer(onboardingReducer, initialOnboardingState);
  const [activeTab, setActiveTab] = useState<Tab>('Home');
  const [activityStarted, setActivityStarted] = useState(false);
  const [movement, setMovement] = useState<MovementType>('walk');
  const [recording, setRecording] = useState<ActivitySession>();
  const [accountId, setAccountId] = useState<string>();
  const [restoring, setRestoring] = useState(true);

  useEffect(() => {
    void Promise.all([activityQueue.initialize(), activityRecorder.initialize()]);
    void authStorage
      .read()
      .then(async (session) => {
        if (!session) return;
        const scope = accountScopeFor(session);
        await activityRecorder.rekeyLegacyScopes(scope, legacyAccountScopesFor(session));
        setAccountId(scope);
        setRecording(await activityRecorder.recover(scope));
        dispatch({ type: 'restoreSession' });
      })
      .finally(() => setRestoring(false));
  }, []);

  if (restoring) return <SafeAreaView style={styles.screen} />;
  if (onboarding.step !== 'complete')
    return <Onboarding state={onboarding} dispatch={dispatch} api={apiClient} />;

  const openActivity = () => {
    setActivityStarted(true);
    setActiveTab('Home');
  };
  const content =
    recording && accountId ? (
      <ActivityRecording
        session={recording}
        accountId={accountId}
        onChange={setRecording}
        sync={activitySync}
      />
    ) : activityStarted && accountId ? (
      <ActivityPreparation
        accountId={accountId}
        initialMovement={movement}
        onChange={setRecording}
      />
    ) : activeTab === 'Home' ? (
      <HomeScreen
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
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />
      <ProductScroll>{content}</ProductScroll>
      <TabBar
        activeTab={activeTab}
        onChange={(tab) => {
          setActivityStarted(false);
          setActiveTab(tab);
        }}
      />
    </SafeAreaView>
  );
}
