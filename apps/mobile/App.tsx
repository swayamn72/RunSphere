import { StatusBar } from 'expo-status-bar';
import * as Location from 'expo-location';
import { Pedometer } from 'expo-sensors';
import { useCallback, useEffect, useReducer, useState } from 'react';
import {
  Alert,
  AppState,
  Linking,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View
} from 'react-native';
import { colors } from '@runsphere/ui';
import { clearAccountData } from './src/account-cleanup';
import { activityQueue } from './src/activity-queue.native';
import { MobileApiClient } from './src/api-client';
import { AuthFailure } from './src/auth-failure';
import { authStorage } from './src/auth-storage.native';
import { getLocationPermissionState } from './src/location-permission';
import { homeModel } from './src/models';
import {
  canSubmitAccount,
  initialOnboardingState,
  onboardingReducer,
  type MovementPreference
} from './src/onboarding';

type Tab = 'Home' | 'Explore' | 'Season' | 'Clubs' | 'You';
type AuthStatus = 'idle' | 'loading' | 'error';
const tabs: readonly Tab[] = ['Home', 'Explore', 'Season', 'Clubs', 'You'];
const apiClient = new MobileApiClient(undefined, fetch, authStorage);

export default function App() {
  const [onboarding, dispatch] = useReducer(onboardingReducer, initialOnboardingState);
  const [activeTab, setActiveTab] = useState<Tab>('Home');
  const [activityStarted, setActivityStarted] = useState(false);
  const [restoring, setRestoring] = useState(true);

  useEffect(() => {
    void activityQueue.initialize();
    void authStorage
      .read()
      .then((session) => {
        if (session) dispatch({ type: 'restoreSession' });
      })
      .finally(() => setRestoring(false));
  }, []);

  if (restoring) return <LoadingScreen label="Restoring your secure session…" />;
  if (onboarding.step !== 'complete') return <Onboarding state={onboarding} dispatch={dispatch} />;

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {activeTab === 'Home' ? (
          <Home
            activityStarted={activityStarted}
            onStart={() => setActivityStarted(true)}
            onOpenProfile={() => setActiveTab('You')}
          />
        ) : activeTab === 'You' ? (
          <Profile />
        ) : (
          <View style={styles.comingSoon}>
            <Text style={styles.eyebrow}>{activeTab.toUpperCase()}</Text>
            <Text style={styles.comingSoonTitle}>{activeTab} is next.</Text>
            <Text style={styles.comingSoonCopy}>More exploration features are on their way.</Text>
          </View>
        )}
      </ScrollView>
      <TabBar activeTab={activeTab} onChange={setActiveTab} />
    </SafeAreaView>
  );
}

function Onboarding({
  state,
  dispatch
}: {
  state: typeof initialOnboardingState;
  dispatch: React.Dispatch<Parameters<typeof onboardingReducer>[1]>;
}) {
  const [authStatus, setAuthStatus] = useState<AuthStatus>('idle');
  const [authError, setAuthError] = useState<string>();
  const [authFailureKind, setAuthFailureKind] = useState<AuthFailure['kind']>();
  const authenticate = async () => {
    if (!canSubmitAccount(state)) return;
    setAuthStatus('loading');
    setAuthError(undefined);
    setAuthFailureKind(undefined);
    try {
      if (state.accountMode === 'login')
        await apiClient.login({ email: state.email.trim(), password: state.password });
      else
        await apiClient.register({
          email: state.email.trim(),
          password: state.password,
          ageAssertion: true,
          policyVersion: 'm1-private-pilot'
        });
      dispatch({ type: 'authenticationSucceeded' });
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Unable to complete authentication.');
      setAuthFailureKind(error instanceof AuthFailure ? error.kind : 'unknown');
      setAuthStatus('error');
      return;
    }
    setAuthStatus('idle');
  };
  const reconcileLocationPermission = useCallback(async () => {
    const permission = await Location.getForegroundPermissionsAsync();
    dispatch({ type: 'setLocation', status: getLocationPermissionState(permission) });
    return permission;
  }, [dispatch]);
  const requestLocation = async () => {
    const currentPermission = await Location.getForegroundPermissionsAsync();
    const currentStatus = getLocationPermissionState(currentPermission);

    if (currentStatus === 'granted') {
      dispatch({ type: 'setLocation', status: 'granted' });
      return;
    }
    if (currentStatus === 'blocked') {
      dispatch({ type: 'setLocation', status: 'blocked' });
      await Linking.openSettings();
      return;
    }

    const requestedPermission = await Location.requestForegroundPermissionsAsync();
    dispatch({
      type: 'setLocation',
      status: getLocationPermissionState(requestedPermission)
    });
  };

  useEffect(() => {
    if (state.step !== 'privacy' && state.step !== 'location-denied') return;

    void reconcileLocationPermission();
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') void reconcileLocationPermission();
    });
    return () => subscription.remove();
  }, [reconcileLocationPermission, state.step]);

  const requestMotion = async () => {
    const permission = await Pedometer.requestPermissionsAsync();
    dispatch({ type: 'setMotion', status: permission.status === 'granted' ? 'granted' : 'denied' });
  };

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />
      <ScrollView
        contentContainerStyle={styles.onboardingContent}
        keyboardShouldPersistTaps="handled"
      >
        {state.step === 'welcome' && (
          <>
            <View accessible={false} style={styles.hero}>
              <View style={styles.orbitOne} />
              <View style={styles.orbitTwo} />
              <Text style={styles.heroPin}>◆</Text>
            </View>
            <Text style={styles.eyebrow}>YOUR WORLD, IN MOTION</Text>
            <Text style={styles.onboardingTitle}>
              Move outside.{'\n'}
              <Text style={styles.teal}>Make it yours.</Text>
            </Text>
            <Text style={styles.lead}>
              Turn everyday walks, runs, and hikes into exploration quests—with seasonal competition
              that stays fair.
            </Text>
            <MovementChoice
              selected={state.movement}
              onChoose={(movement) => dispatch({ type: 'chooseMovement', movement })}
            />
            <PrimaryButton
              label="Create account"
              onPress={() => dispatch({ type: 'startAccount', mode: 'register' })}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="I already have an account"
              onPress={() => dispatch({ type: 'startAccount', mode: 'login' })}
            >
              <Text style={styles.textButton}>I already have an account</Text>
            </Pressable>
          </>
        )}
        {state.step === 'account' && (
          <>
            <StepHeader
              step={state.accountMode === 'login' ? 'SIGN IN' : 'STEP 1 OF 3'}
              onBack={() => dispatch({ type: 'back' })}
            />
            <Text style={styles.eyebrow}>
              {state.accountMode === 'login' ? 'WELCOME BACK' : 'MAKE IT YOURS'}
            </Text>
            <Text style={styles.onboardingTitle}>
              {state.accountMode === 'login' ? 'Sign in securely.' : 'A few details first.'}
            </Text>
            <Text style={styles.lead}>
              {state.accountMode === 'login'
                ? 'Use your email and password to restore your private RunSphere account.'
                : 'We use your email and password to create your private RunSphere account.'}
            </Text>
            {state.accountMode === 'register' && (
              <>
                <Text style={styles.fieldLabel}>DISPLAY NAME</Text>
                <TextInput
                  accessibilityLabel="Display name"
                  autoCapitalize="words"
                  value={state.name}
                  onChangeText={(name) => dispatch({ type: 'updateAccount', name })}
                  placeholder="How should we call you?"
                  placeholderTextColor={colors.muted}
                  style={styles.input}
                />
              </>
            )}
            <Text style={styles.fieldLabel}>EMAIL</Text>
            <TextInput
              accessibilityLabel="Email address"
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              value={state.email}
              onChangeText={(email) => dispatch({ type: 'updateAccount', email })}
              placeholder="you@example.com"
              placeholderTextColor={colors.muted}
              style={styles.input}
            />
            <Text style={styles.fieldLabel}>PASSWORD</Text>
            <TextInput
              accessibilityLabel="Password"
              autoCapitalize="none"
              autoComplete={state.accountMode === 'login' ? 'current-password' : 'new-password'}
              secureTextEntry
              value={state.password}
              onChangeText={(password) => dispatch({ type: 'updateAccount', password })}
              placeholder="At least 12 characters"
              placeholderTextColor={colors.muted}
              style={styles.input}
            />
            {state.accountMode === 'register' && (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: state.isAdult }}
                accessibilityLabel="I confirm that I am 18 or older"
                onPress={() => dispatch({ type: 'updateAccount', isAdult: !state.isAdult })}
                style={styles.checkRow}
              >
                <View style={[styles.checkbox, state.isAdult && styles.checkboxChecked]}>
                  {state.isAdult && <Text style={styles.checkMark}>✓</Text>}
                </View>
                <Text style={styles.checkCopy}>I confirm that I am 18 or older.</Text>
              </Pressable>
            )}
            {authError && (
              <Text accessibilityLiveRegion="polite" style={styles.errorText}>
                {authError}
              </Text>
            )}
            {authFailureKind === 'account-exists' && (
              <Pressable
                accessibilityRole="button"
                disabled={authStatus === 'loading'}
                onPress={() => {
                  setAuthError(undefined);
                  setAuthFailureKind(undefined);
                  setAuthStatus('idle');
                  dispatch({ type: 'startAccount', mode: 'login' });
                }}
              >
                <Text style={styles.textButton}>Sign in with this email</Text>
              </Pressable>
            )}
            <PrimaryButton
              label={
                authStatus === 'loading'
                  ? 'Please wait…'
                  : authStatus === 'error'
                    ? 'Try again'
                    : state.accountMode === 'login'
                      ? 'Sign in'
                      : 'Create account'
              }
              disabled={!canSubmitAccount(state) || authStatus === 'loading'}
              onPress={() => void authenticate()}
            />
            <Pressable
              accessibilityRole="button"
              disabled={authStatus === 'loading'}
              onPress={() =>
                dispatch({
                  type: 'startAccount',
                  mode: state.accountMode === 'login' ? 'register' : 'login'
                })
              }
            >
              <Text style={styles.textButton}>
                {state.accountMode === 'login'
                  ? 'Need an account? Create one'
                  : 'Already have an account? Sign in'}
              </Text>
            </Pressable>
          </>
        )}
        {state.step === 'privacy' && (
          <>
            <StepHeader step="STEP 2 OF 3" onBack={() => dispatch({ type: 'back' })} />
            <View accessible={false} style={styles.miniMap}>
              <Text style={styles.mapRoute}>⌁</Text>
              <Text style={styles.mapShield}>✓</Text>
            </View>
            <Text style={styles.eyebrow}>YOU’RE IN CONTROL</Text>
            <Text style={styles.onboardingTitle}>Set up your activity map.</Text>
            <Text style={styles.lead}>
              Location is requested only while you use the app for activity mapping. We do not
              request background location, and no GPS trace is stored in this pilot.
            </Text>
            <PermissionCard
              icon="⌖"
              title="Precise location"
              detail="Only while using the app; not retained as a trace yet"
              badge="Required"
            />
            <PermissionCard
              icon="◉"
              title="Motion & fitness"
              detail="Optional; improves future estimates"
              badge="Optional"
            />
            <View style={styles.privacyRow}>
              <View style={styles.flexCopy}>
                <Text style={styles.rowTitle}>Hide start & finish</Text>
                <Text style={styles.rowDetail}>
                  Pilot preference only — applies after server privacy zones exist
                </Text>
              </View>
              <Switch
                accessibilityLabel="Hide activity start and finish preference"
                value={state.hideStartFinish}
                onValueChange={(value) => dispatch({ type: 'setHideStartFinish', value })}
                trackColor={{ false: colors.line, true: colors.teal }}
              />
            </View>
            <Text style={styles.privateNote}>
              Visibility stays Private in this pilot. Declining location still lets you browse
              RunSphere, but activity mapping and nearby quests remain unavailable.
            </Text>
            {state.location !== 'granted' ? (
              <PrimaryButton label="Allow location" onPress={() => void requestLocation()} />
            ) : (
              <PrimaryButton
                label="Continue to RunSphere"
                onPress={() => dispatch({ type: 'finish' })}
              />
            )}
            {state.location === 'granted' && state.motion === 'idle' && (
              <Pressable accessibilityRole="button" onPress={() => void requestMotion()}>
                <Text style={styles.textButton}>Allow motion & fitness (optional)</Text>
              </Pressable>
            )}
            <Pressable accessibilityRole="button" onPress={() => dispatch({ type: 'finish' })}>
              <Text style={styles.textButton}>Continue without location</Text>
            </Pressable>
          </>
        )}
        {state.step === 'location-denied' && (
          <>
            <StepHeader step="LOCATION NEEDED" onBack={() => dispatch({ type: 'back' })} />
            <Text style={styles.eyebrow}>LOCATION IS OFF</Text>
            <Text style={styles.onboardingTitle}>You can keep browsing.</Text>
            <Text style={styles.lead}>
              Without location, activity mapping and nearby quests are unavailable. RunSphere never
              requests background location in this pilot, and it stores no GPS trace.
            </Text>
            {state.location === 'blocked' && (
              <Text style={styles.privateNote}>
                Location is disabled for RunSphere. Enable it in Android Settings, then return here.
              </Text>
            )}
            <PrimaryButton
              label={state.location === 'blocked' ? 'Open location settings' : 'Try location again'}
              onPress={() => void requestLocation()}
            />
            <Pressable
              accessibilityRole="button"
              onPress={() => dispatch({ type: 'continueWithoutLocation' })}
            >
              <Text style={styles.textButton}>Continue without activity mapping</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Home({
  activityStarted,
  onStart,
  onOpenProfile
}: {
  activityStarted: boolean;
  onStart: () => void;
  onOpenProfile: () => void;
}) {
  const { dailyPath, member, nearbyQuest } = homeModel;
  return (
    <>
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>{homeModel.dateLabel}</Text>
          <Text style={styles.greeting}>Good morning, {member.name}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open profile"
          onPress={onOpenProfile}
          style={styles.avatar}
        >
          <Text style={styles.avatarText}>{member.initials}</Text>
        </Pressable>
      </View>
      <View style={styles.dailyCard}>
        <View style={styles.cardTopline}>
          <View>
            <Text style={styles.cardEyebrow}>DAILY PATH</Text>
            <Text style={styles.cardTitle}>{dailyPath.title}</Text>
          </View>
          <Text style={styles.xp}>+{dailyPath.rewardXp} XP</Text>
        </View>
        <Text style={styles.cardCopy}>
          Visit 3 green spaces. Walk, run, or hike—your pace, your route.
        </Text>
        <View style={styles.progressTrack}>
          <View style={styles.progressFill} />
        </View>
        <View style={styles.progressMeta}>
          <Text style={styles.progressStrong}>
            {dailyPath.found} of {dailyPath.total} found
          </Text>
          <Text style={styles.cardMuted}>6h 14m left</Text>
        </View>
      </View>
      <View style={styles.statsRow}>
        <Stat
          label="THIS WEEK"
          value={`${member.weekDistanceKm}`}
          suffix="km"
          detail="↑ 8% from last week"
        />
        <View style={styles.divider} />
        <Stat label="SEASON RANK" value={`#${member.seasonRank}`} detail="Silver division" />
      </View>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Near you</Text>
        <Text style={styles.link}>See all</Text>
      </View>
      <View style={styles.questCard}>
        <View style={styles.terrain}>
          <Text style={styles.distanceBadge}>{nearbyQuest.distanceKm} km</Text>
        </View>
        <View style={styles.questCopy}>
          <Text style={styles.questTitle}>{nearbyQuest.title}</Text>
          <Text style={styles.muted}>Easy · {nearbyQuest.durationMinutes} min · Any pace</Text>
          <Text style={styles.reward}>{nearbyQuest.rewardXp} XP · 2 cells</Text>
        </View>
      </View>
      <PrimaryButton
        label={activityStarted ? 'Activity setup ready' : 'Start activity'}
        onPress={onStart}
      />
      {activityStarted && (
        <Text accessibilityLiveRegion="polite" style={styles.confirmation}>
          Activity recording and queue upload are deferred. No route trace is stored yet.
        </Text>
      )}
    </>
  );
}

function Profile() {
  const clearLocalAccountData = (action: 'Log out' | 'Delete account') =>
    Alert.alert(
      action,
      'This clears local secure tokens and queued activity metadata. Account deletion remains a pilot-only placeholder.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: action,
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                if (action === 'Log out') await apiClient.logout();
              } finally {
                await clearAccountData(activityQueue, authStorage);
                Alert.alert(
                  'Local data cleared',
                  'Secure tokens and queued metadata were removed.'
                );
              }
            })();
          }
        }
      ]
    );
  return (
    <>
      <View style={styles.profileHeader}>
        <Text style={styles.iconButton}>‹</Text>
        <Text style={styles.eyebrow}>PROFILE</Text>
        <Text style={styles.iconButton}>✎</Text>
      </View>
      <View style={styles.profileHead}>
        <View style={styles.bigAvatar}>
          <Text style={styles.bigAvatarText}>MH</Text>
        </View>
        <View style={styles.flexCopy}>
          <Text style={styles.profileName}>Maya Hart</Text>
          <Text style={styles.muted}>@mayamoves · Mumbai</Text>
          <Text style={styles.level}>LEVEL 14 · PATHFINDER</Text>
        </View>
      </View>
      <View style={styles.profileStats}>
        <ProfileStat value="186" label="CELLS" />
        <ProfileStat value="28" label="QUESTS" />
        <ProfileStat value="9" label="WEEK STREAK" />
      </View>
      <SettingsGroup title="Activity preferences">
        <Setting label="Primary movement" value="Pilot-only" disabled />
        <Setting label="Accessibility" value="Pilot-only" disabled />
      </SettingsGroup>
      <SettingsGroup title="Privacy & safety">
        <Setting label="Activity visibility" value="Private · pilot-only" disabled />
        <Setting label="Hide start & finish" value="Requires server privacy zones" disabled />
        <Setting label="Privacy zones" value="Pilot-only" disabled />
        <Setting label="Safety contact" value="Pilot-only" disabled />
      </SettingsGroup>
      <SettingsGroup title="Data">
        <Setting label="Export your data" value="Pilot placeholder" disabled />
        <Setting
          label="Log out"
          value="Clear this device"
          onPress={() => clearLocalAccountData('Log out')}
        />
        <Setting
          label="Delete account"
          value="Pilot placeholder"
          destructive
          onPress={() => clearLocalAccountData('Delete account')}
        />
      </SettingsGroup>
    </>
  );
}

function MovementChoice({
  selected,
  onChoose
}: {
  selected: MovementPreference;
  onChoose: (movement: MovementPreference) => void;
}) {
  const labels: Record<MovementPreference, [string, string]> = {
    walk: ['Walk', 'Every step counts'],
    run: ['Run', 'Find your pace'],
    hike: ['Hike', 'Explore farther']
  };
  return (
    <View style={styles.choiceGrid}>
      {(Object.keys(labels) as MovementPreference[]).map((movement) => (
        <Pressable
          key={movement}
          accessibilityRole="radio"
          accessibilityState={{ selected: selected === movement }}
          accessibilityLabel={`Choose ${labels[movement][0].toLowerCase()}`}
          onPress={() => onChoose(movement)}
          style={[styles.choice, selected === movement && styles.choiceSelected]}
        >
          <Text style={styles.choiceTitle}>{labels[movement][0]}</Text>
          <Text style={styles.rowDetail}>{labels[movement][1]}</Text>
        </Pressable>
      ))}
    </View>
  );
}
function StepHeader({ step, onBack }: { step: string; onBack: () => void }) {
  return (
    <View style={styles.stepHeader}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Go back"
        onPress={onBack}
        style={styles.backButton}
      >
        <Text style={styles.backText}>‹</Text>
      </Pressable>
      <Text style={styles.stepText}>{step}</Text>
      <View style={styles.backButton} />
    </View>
  );
}
function PermissionCard({
  icon,
  title,
  detail,
  badge
}: {
  icon: string;
  title: string;
  detail: string;
  badge: string;
}) {
  return (
    <View style={styles.permissionCard}>
      <Text style={styles.permissionIcon}>{icon}</Text>
      <View style={styles.flexCopy}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowDetail}>{detail}</Text>
      </View>
      <Text style={[styles.badge, badge === 'Optional' && styles.optionalBadge]}>{badge}</Text>
    </View>
  );
}
function PrimaryButton({
  label,
  onPress,
  disabled = false
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primaryButton,
        (pressed || disabled) && styles.buttonPressed,
        disabled && styles.buttonDisabled
      ]}
    >
      <Text style={styles.primaryText}>{label}</Text>
      <Text style={styles.primaryArrow}>→</Text>
    </Pressable>
  );
}
function TabBar({ activeTab, onChange }: { activeTab: Tab; onChange: (tab: Tab) => void }) {
  return (
    <View style={styles.nav} accessibilityRole="tablist">
      {tabs.map((tab) => (
        <Pressable
          key={tab}
          onPress={() => onChange(tab)}
          accessibilityRole="tab"
          accessibilityState={{ selected: activeTab === tab }}
          style={styles.navItem}
        >
          <Text style={[styles.navIcon, activeTab === tab && styles.navActive]}>
            {tab === 'Home'
              ? '⌂'
              : tab === 'Explore'
                ? '⌖'
                : tab === 'Season'
                  ? '⬡'
                  : tab === 'Clubs'
                    ? '◎'
                    : '◉'}
          </Text>
          <Text style={[styles.navText, activeTab === tab && styles.navActive]}>{tab}</Text>
        </Pressable>
      ))}
    </View>
  );
}
function Stat({
  label,
  value,
  suffix,
  detail
}: {
  label: string;
  value: string;
  suffix?: string;
  detail: string;
}) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <View style={styles.statValueLine}>
        <Text style={styles.statValue}>{value}</Text>
        {suffix && <Text style={styles.statSuffix}>{suffix}</Text>}
      </View>
      <Text style={styles.statDetail}>{detail}</Text>
    </View>
  );
}
function SettingsGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.settingsGroup}>
      <Text style={styles.settingsTitle}>{title}</Text>
      {children}
    </View>
  );
}
function Setting({
  label,
  value,
  onPress,
  destructive = false,
  disabled = false
}: {
  label: string;
  value: string;
  onPress?: () => void;
  destructive?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      accessibilityLabel={`${label}, ${value}`}
      onPress={onPress}
      style={[styles.setting, disabled && styles.settingDisabled]}
    >
      <Text style={[styles.rowTitle, destructive && styles.destructive]}>{label}</Text>
      <Text style={[styles.settingValue, destructive && styles.destructive]}>
        {value}
        {onPress ? ' ›' : ''}
      </Text>
    </Pressable>
  );
}
function ProfileStat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.profileStat}>
      <Text style={styles.profileStatValue}>{value}</Text>
      <Text style={styles.profileStatLabel}>{label}</Text>
    </View>
  );
}
function LoadingScreen({ label }: { label: string }) {
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.loading}>
        <Text accessibilityLiveRegion="polite" style={styles.lead}>
          {label}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.cream },
  content: { padding: 20, paddingBottom: 118 },
  onboardingContent: { padding: 20, paddingBottom: 44 },
  flexCopy: { flex: 1 },
  loading: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: 30 },
  eyebrow: { color: colors.teal, fontSize: 11, fontWeight: '900', letterSpacing: 1.4 },
  teal: { color: colors.teal },
  lead: { color: colors.muted, fontSize: 16, lineHeight: 24, marginBottom: 18 },
  onboardingTitle: {
    color: colors.ink,
    fontSize: 34,
    fontWeight: '900',
    letterSpacing: -1.3,
    lineHeight: 36,
    marginBottom: 14
  },
  errorText: { color: '#B83220', fontSize: 14, fontWeight: '700', lineHeight: 20, marginTop: 16 },
  hero: {
    backgroundColor: colors.moss,
    height: 234,
    marginHorizontal: -20,
    marginTop: -20,
    marginBottom: 25,
    overflow: 'hidden'
  },
  orbitOne: {
    borderColor: '#C9F15A77',
    borderRadius: 160,
    borderWidth: 1,
    height: 290,
    left: -55,
    position: 'absolute',
    top: -70,
    width: 290
  },
  orbitTwo: {
    borderColor: '#C9F15A77',
    borderRadius: 110,
    borderWidth: 1,
    bottom: -55,
    height: 200,
    position: 'absolute',
    right: -45,
    width: 200
  },
  heroPin: { color: colors.lime, fontSize: 44, left: '54%', position: 'absolute', top: 102 },
  choiceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  choice: {
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderRadius: 16,
    borderWidth: 1,
    flexGrow: 1,
    minHeight: 82,
    minWidth: '30%',
    padding: 14
  },
  choiceSelected: { backgroundColor: '#EEF9E7', borderColor: colors.teal, borderWidth: 2 },
  choiceTitle: { color: colors.ink, fontSize: 17, fontWeight: '900', marginBottom: 5 },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.moss,
    borderRadius: 18,
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 12,
    minHeight: 56,
    paddingHorizontal: 20
  },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '900' },
  primaryArrow: { color: '#fff', fontSize: 20, position: 'absolute', right: 19 },
  buttonPressed: { opacity: 0.8 },
  buttonDisabled: { backgroundColor: '#789488' },
  textButton: {
    color: colors.moss,
    fontSize: 15,
    fontWeight: '800',
    marginTop: 20,
    textAlign: 'center'
  },
  stepHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    height: 58,
    justifyContent: 'space-between',
    marginBottom: 18
  },
  backButton: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderRadius: 20,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    width: 40
  },
  backText: { color: colors.ink, fontSize: 28, lineHeight: 30 },
  stepText: { color: colors.muted, fontSize: 11, fontWeight: '900', letterSpacing: 1.2 },
  fieldLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.1,
    marginBottom: 7,
    marginTop: 10
  },
  input: {
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderRadius: 14,
    borderWidth: 1,
    color: colors.ink,
    fontSize: 16,
    minHeight: 54,
    paddingHorizontal: 15
  },
  checkRow: { alignItems: 'center', flexDirection: 'row', marginTop: 20, paddingVertical: 5 },
  checkbox: {
    alignItems: 'center',
    borderColor: colors.muted,
    borderRadius: 5,
    borderWidth: 2,
    height: 22,
    justifyContent: 'center',
    marginRight: 10,
    width: 22
  },
  checkboxChecked: { backgroundColor: colors.teal, borderColor: colors.teal },
  checkMark: { color: '#fff', fontWeight: '900' },
  checkCopy: { color: colors.ink, flex: 1, fontSize: 15, lineHeight: 21 },
  miniMap: {
    alignItems: 'center',
    backgroundColor: colors.blue,
    borderRadius: 20,
    height: 130,
    justifyContent: 'center',
    marginBottom: 20,
    overflow: 'hidden'
  },
  mapRoute: { color: colors.moss, fontSize: 112, transform: [{ rotate: '-20deg' }] },
  mapShield: {
    backgroundColor: colors.moss,
    borderRadius: 20,
    color: colors.lime,
    fontSize: 18,
    fontWeight: '900',
    paddingHorizontal: 10,
    paddingVertical: 7,
    position: 'absolute',
    right: 36,
    top: 42
  },
  permissionCard: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    marginBottom: 10,
    minHeight: 78,
    padding: 13
  },
  permissionIcon: { color: colors.teal, fontSize: 27, marginRight: 12 },
  rowTitle: { color: colors.ink, fontSize: 15, fontWeight: '800' },
  rowDetail: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 3 },
  badge: {
    backgroundColor: '#E6F5DB',
    borderRadius: 12,
    color: colors.moss,
    fontSize: 10,
    fontWeight: '900',
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 5
  },
  optionalBadge: { backgroundColor: '#F1EEE2', color: colors.muted },
  privacyRow: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    marginTop: 4,
    minHeight: 80,
    padding: 13
  },
  privateNote: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 10 },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    height: 76,
    justifyContent: 'space-between'
  },
  greeting: { color: colors.ink, fontSize: 19, fontWeight: '800', marginTop: 5 },
  avatar: {
    alignItems: 'center',
    backgroundColor: colors.moss,
    borderRadius: 21,
    height: 42,
    justifyContent: 'center',
    width: 42
  },
  avatarText: { color: '#fff', fontWeight: '900' },
  dailyCard: {
    backgroundColor: colors.moss,
    borderRadius: 22,
    minHeight: 200,
    overflow: 'hidden',
    padding: 20
  },
  cardTopline: { flexDirection: 'row', justifyContent: 'space-between' },
  cardEyebrow: { color: colors.lime, fontSize: 11, fontWeight: '900', letterSpacing: 1.3 },
  cardTitle: { color: '#fff', fontSize: 21, fontWeight: '900', marginTop: 5 },
  xp: {
    alignSelf: 'flex-start',
    backgroundColor: colors.lime,
    borderRadius: 14,
    color: colors.ink,
    fontSize: 12,
    fontWeight: '900',
    paddingHorizontal: 10,
    paddingVertical: 6
  },
  cardCopy: { color: '#ECF1E8', lineHeight: 21, marginTop: 16, maxWidth: '80%' },
  progressTrack: {
    backgroundColor: '#4D786A',
    borderRadius: 10,
    height: 8,
    marginTop: 20,
    overflow: 'hidden'
  },
  progressFill: { backgroundColor: colors.lime, borderRadius: 10, height: '100%', width: '66%' },
  progressMeta: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 9 },
  progressStrong: { color: '#fff', fontSize: 12, fontWeight: '800' },
  cardMuted: { color: '#D4DFD6', fontSize: 12 },
  statsRow: {
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    marginTop: 18,
    padding: 17
  },
  stat: { flex: 1 },
  divider: { backgroundColor: colors.line, marginHorizontal: 14, width: 1 },
  statLabel: { color: colors.muted, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  statValueLine: { alignItems: 'baseline', flexDirection: 'row', marginTop: 5 },
  statValue: { color: colors.ink, fontSize: 24, fontWeight: '900' },
  statSuffix: { color: colors.muted, fontSize: 12, fontWeight: '700', marginLeft: 3 },
  statDetail: { color: colors.teal, fontSize: 10, fontWeight: '700', marginTop: 5 },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
    marginTop: 26
  },
  sectionTitle: { color: colors.ink, fontSize: 18, fontWeight: '900' },
  link: { color: colors.moss, fontWeight: '800' },
  questCard: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: 112,
    padding: 10
  },
  terrain: {
    alignItems: 'center',
    backgroundColor: '#9DC6B1',
    borderRadius: 13,
    height: 90,
    justifyContent: 'center',
    width: 88
  },
  distanceBadge: {
    backgroundColor: colors.card,
    borderRadius: 12,
    color: colors.ink,
    fontSize: 12,
    fontWeight: '900',
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 5
  },
  questCopy: { flex: 1, marginLeft: 13 },
  questTitle: { color: colors.ink, fontSize: 16, fontWeight: '900', marginBottom: 4 },
  muted: { color: colors.muted, fontSize: 13 },
  reward: { color: colors.teal, fontSize: 12, fontWeight: '800', marginTop: 7 },
  confirmation: { color: colors.teal, fontWeight: '700', marginTop: 16, textAlign: 'center' },
  nav: {
    backgroundColor: '#FFFEF8F5',
    borderColor: colors.line,
    borderTopWidth: 1,
    bottom: 0,
    flexDirection: 'row',
    left: 0,
    minHeight: 76,
    paddingBottom: 8,
    position: 'absolute',
    right: 0
  },
  navItem: { alignItems: 'center', flex: 1, justifyContent: 'center', paddingTop: 6 },
  navIcon: { color: '#7B8781', fontSize: 20 },
  navText: { color: '#7B8781', fontSize: 10, fontWeight: '800', marginTop: 3 },
  navActive: { color: colors.teal },
  comingSoon: { flex: 1, justifyContent: 'center', minHeight: 480, paddingHorizontal: 22 },
  comingSoonTitle: { color: colors.ink, fontSize: 32, fontWeight: '900', marginTop: 8 },
  comingSoonCopy: { color: colors.muted, fontSize: 16, lineHeight: 24, marginTop: 14 },
  profileHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 18
  },
  iconButton: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderRadius: 20,
    borderWidth: 1,
    color: colors.ink,
    fontSize: 22,
    height: 40,
    overflow: 'hidden',
    textAlign: 'center',
    textAlignVertical: 'center',
    width: 40
  },
  profileHead: { alignItems: 'center', flexDirection: 'row', marginBottom: 18 },
  bigAvatar: {
    alignItems: 'center',
    backgroundColor: colors.moss,
    borderRadius: 34,
    height: 68,
    justifyContent: 'center',
    marginRight: 14,
    width: 68
  },
  bigAvatarText: { color: '#fff', fontSize: 20, fontWeight: '900' },
  profileName: { color: colors.ink, fontSize: 25, fontWeight: '900' },
  level: {
    alignSelf: 'flex-start',
    backgroundColor: '#E6F5DB',
    borderRadius: 9,
    color: colors.moss,
    fontSize: 10,
    fontWeight: '900',
    marginTop: 7,
    overflow: 'hidden',
    paddingHorizontal: 7,
    paddingVertical: 4
  },
  profileStats: {
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderRadius: 17,
    borderWidth: 1,
    flexDirection: 'row',
    marginBottom: 22,
    paddingVertical: 14
  },
  profileStat: { alignItems: 'center', flex: 1 },
  profileStatValue: { color: colors.ink, fontSize: 20, fontWeight: '900' },
  profileStatLabel: {
    color: colors.muted,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.8,
    marginTop: 4
  },
  settingsGroup: {
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderRadius: 17,
    borderWidth: 1,
    marginBottom: 16,
    overflow: 'hidden'
  },
  settingsTitle: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: '900',
    paddingHorizontal: 15,
    paddingTop: 15
  },
  setting: {
    alignItems: 'center',
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 54,
    paddingHorizontal: 15
  },
  settingDisabled: { opacity: 0.55 },
  settingValue: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700',
    marginLeft: 12,
    textAlign: 'right'
  },
  destructive: { color: '#B83220' }
});
