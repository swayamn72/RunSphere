import { StatusBar } from 'expo-status-bar';
import * as Location from 'expo-location';
import { Pedometer } from 'expo-sensors';
import { useEffect, useReducer, useState } from 'react';
import {
  Alert,
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
import { authStorage } from './src/auth-storage.native';
import { homeModel } from './src/models';
import {
  canSubmitAccount,
  initialOnboardingState,
  onboardingReducer,
  type MovementPreference
} from './src/onboarding';

type Tab = 'Home' | 'Explore' | 'Season' | 'Clubs' | 'You';

const tabs: readonly Tab[] = ['Home', 'Explore', 'Season', 'Clubs', 'You'];

export default function App() {
  const [onboarding, dispatch] = useReducer(onboardingReducer, initialOnboardingState);
  const [activeTab, setActiveTab] = useState<Tab>('Home');
  const [activityStarted, setActivityStarted] = useState(false);

  useEffect(() => {
    void activityQueue.initialize();
  }, []);

  if (onboarding.step !== 'complete') {
    return <Onboarding state={onboarding} dispatch={dispatch} />;
  }

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
            <Text style={styles.comingSoonCopy}>
              Your M1 profile and private activity controls are ready now. More exploration features
              are on their way.
            </Text>
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
  const requestLocation = async () => {
    const permission = await Location.requestForegroundPermissionsAsync();
    dispatch({
      type: 'setLocation',
      status: permission.status === 'granted' ? 'granted' : 'denied'
    });
  };
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
              Move outside.{`\n`}
              <Text style={styles.teal}>Make it yours.</Text>
            </Text>
            <Text style={styles.lead}>
              Turn everyday walks and runs into exploration quests—with seasonal competition that
              stays fair.
            </Text>
            <MovementChoice
              selected={state.movement}
              onChoose={(movement) => dispatch({ type: 'chooseMovement', movement })}
            />
            <PrimaryButton label="Get started" onPress={() => dispatch({ type: 'startAccount' })} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="I already have an account"
              onPress={() => dispatch({ type: 'startAccount' })}
              hitSlop={10}
            >
              <Text style={styles.textButton}>I already have an account</Text>
            </Pressable>
          </>
        )}

        {state.step === 'account' && (
          <>
            <StepHeader step="STEP 1 OF 3" onBack={() => dispatch({ type: 'back' })} />
            <Text style={styles.eyebrow}>MAKE IT YOURS</Text>
            <Text style={styles.onboardingTitle}>A few details first.</Text>
            <Text style={styles.lead}>
              We use these details to create your private RunSphere profile.
            </Text>
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
            <PrimaryButton
              label="Continue"
              disabled={!canSubmitAccount(state)}
              onPress={() => dispatch({ type: 'submitAccount' })}
            />
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
              RunSphere uses location while you move to map distance, quests, and territory.
            </Text>
            <PermissionCard
              icon="⌖"
              title="Precise location"
              detail="Only during an activity"
              badge="Required"
            />
            <PermissionCard
              icon="◉"
              title="Motion & fitness"
              detail="Improves pace and distance"
              badge="Optional"
            />
            <View style={styles.privacyRow}>
              <View style={styles.flexCopy}>
                <Text style={styles.rowTitle}>Hide start & finish</Text>
                <Text style={styles.rowDetail}>Blur 200 m around saved places</Text>
              </View>
              <Switch
                accessibilityLabel="Hide activity start and finish within 200 metres"
                value={state.hideStartFinish}
                onValueChange={(value) => dispatch({ type: 'setHideStartFinish', value })}
                trackColor={{ false: colors.line, true: colors.teal }}
              />
            </View>
            <Text style={styles.privateNote}>
              Activity visibility is Private by default. You can change this later in You.
            </Text>
            {state.location !== 'granted' ? (
              <PrimaryButton label="Allow location" onPress={() => void requestLocation()} />
            ) : (
              <PrimaryButton
                label="Location allowed"
                onPress={() => dispatch({ type: 'finish' })}
              />
            )}
            {state.location === 'granted' && state.motion === 'idle' && (
              <Pressable accessibilityRole="button" onPress={() => void requestMotion()}>
                <Text style={styles.textButton}>Allow motion & fitness (optional)</Text>
              </Pressable>
            )}
            {state.location === 'granted' && state.motion !== 'idle' && (
              <Pressable accessibilityRole="button" onPress={() => dispatch({ type: 'finish' })}>
                <Text style={styles.textButton}>Continue to RunSphere</Text>
              </Pressable>
            )}
            <Pressable
              accessibilityRole="link"
              onPress={() =>
                Alert.alert(
                  'Privacy policy',
                  'Policy review will be available before pilot launch.'
                )
              }
            >
              <Text style={styles.textButton}>Review privacy policy</Text>
            </Pressable>
          </>
        )}

        {state.step === 'location-denied' && (
          <>
            <StepHeader step="LOCATION NEEDED" onBack={() => dispatch({ type: 'back' })} />
            <Text style={styles.eyebrow}>LOCATION IS OFF</Text>
            <Text style={styles.onboardingTitle}>We can’t map an activity yet.</Text>
            <Text style={styles.lead}>
              Allow location while using the app to record distance and show nearby quests. We never
              ask for background location in this pilot.
            </Text>
            <PrimaryButton
              label="Try location again"
              onPress={() => {
                dispatch({ type: 'retryLocation' });
                void requestLocation();
              }}
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
  const queueActivity = () => {
    const id = `starter-activity-${new Date().toISOString()}`;
    void activityQueue.enqueue({
      id,
      createdAt: new Date().toISOString(),
      movementType: 'walk',
      status: 'ready'
    });
    onStart();
  };

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
          Visit 3 green spaces. Walk or run—your pace, your route.
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
        label={activityStarted ? 'Activity ready' : 'Start activity'}
        onPress={queueActivity}
      />
      {activityStarted && (
        <Text accessibilityLiveRegion="polite" style={styles.confirmation}>
          GPS setup is next. Your route stays private by default.
        </Text>
      )}
    </>
  );
}

function Profile() {
  const [hideStartFinish, setHideStartFinish] = useState(true);
  const [visibility, setVisibility] = useState<'Private' | 'Friends'>('Private');
  const placeholder = (action: string) =>
    Alert.alert(`${action} placeholder`, `${action} is not available in the M1 private pilot yet.`);
  const clearLocalAccountData = (action: 'Log out' | 'Delete account') => {
    Alert.alert(
      action,
      `This pilot placeholder clears local secure tokens and queued activity metadata.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: action,
          style: 'destructive',
          onPress: () => {
            void clearAccountData(activityQueue, authStorage).then(() =>
              Alert.alert(
                'Local data cleared',
                'Secure tokens and queued activity metadata were removed from this device.'
              )
            );
          }
        }
      ]
    );
  };
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
        <Setting label="Primary movement" value="Walking + running" />
        <Setting label="Accessibility" value="Step-free routes" />
      </SettingsGroup>
      <SettingsGroup title="Privacy & safety">
        <Setting
          label="Activity visibility"
          value={visibility}
          onPress={() => setVisibility(visibility === 'Private' ? 'Friends' : 'Private')}
        />
        <View style={styles.settingSwitch}>
          <View style={styles.flexCopy}>
            <Text style={styles.rowTitle}>Hide start & finish</Text>
            <Text style={styles.rowDetail}>Blur 200 m around saved places</Text>
          </View>
          <Switch
            accessibilityLabel="Hide start and finish privacy zone"
            value={hideStartFinish}
            onValueChange={setHideStartFinish}
            trackColor={{ false: colors.line, true: colors.teal }}
          />
        </View>
        <Setting label="Privacy zones" value="2 places" />
        <Setting label="Safety contact" value="Elena R." />
      </SettingsGroup>
      <SettingsGroup title="Data">
        <Setting
          label="Export your data"
          value="Pilot placeholder"
          onPress={() => placeholder('Export your data')}
        />
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
  return (
    <View style={styles.choiceGrid}>
      {(['walk', 'run'] as const).map((movement) => (
        <Pressable
          key={movement}
          accessibilityRole="radio"
          accessibilityState={{ selected: selected === movement }}
          accessibilityLabel={`Choose ${movement === 'walk' ? 'walking' : 'running'}`}
          onPress={() => onChoose(movement)}
          style={[styles.choice, selected === movement && styles.choiceSelected]}
        >
          <Text style={styles.choiceTitle}>{movement === 'walk' ? 'Walk' : 'Run'}</Text>
          <Text style={styles.rowDetail}>
            {movement === 'walk' ? 'Every step counts' : 'Find your pace'}
          </Text>
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
  destructive = false
}: {
  label: string;
  value: string;
  onPress?: () => void;
  destructive?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${value}`}
      onPress={onPress}
      style={styles.setting}
    >
      <Text style={[styles.rowTitle, destructive && styles.destructive]}>{label}</Text>
      <Text style={[styles.settingValue, destructive && styles.destructive]}>{value} ›</Text>
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

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.cream },
  content: { padding: 20, paddingBottom: 118 },
  onboardingContent: { padding: 20, paddingBottom: 44 },
  flexCopy: { flex: 1 },
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
  choiceGrid: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  choice: {
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderRadius: 16,
    borderWidth: 1,
    flex: 1,
    minHeight: 82,
    padding: 14
  },
  choiceSelected: { borderColor: colors.teal, borderWidth: 2, backgroundColor: '#EEF9E7' },
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
  settingValue: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700',
    marginLeft: 12,
    textAlign: 'right'
  },
  settingSwitch: {
    alignItems: 'center',
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    flexDirection: 'row',
    minHeight: 70,
    paddingHorizontal: 15
  },
  destructive: { color: '#B83220' }
});
