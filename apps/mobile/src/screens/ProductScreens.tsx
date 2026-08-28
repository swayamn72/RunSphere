import { useEffect, useState } from 'react';
import { Alert, Linking, Pressable, Switch, Text, TextInput, View } from 'react-native';
import * as Location from 'expo-location';
import type {
  QuestDetail,
  QuestSummary,
  SafetyContactResponse,
  WeeklyGoalResponse
} from '@runsphere/contracts';
import type { MobileApiClient } from '../api-client';
import { clearAccountData } from '../account-cleanup';
import { activityQueue } from '../activity-queue.native';
import { activityRecorder } from '../activity-recorder.native';
import { authStorage } from '../auth-storage.native';
import {
  MovementChoice,
  PrimaryButton,
  Setting,
  SettingsGroup,
  Stat
} from '../components/primitives';
import { LoopMascot } from '../components/Mascot';
import { useAppTheme } from '../theme/theme';
import { useAppStyles } from '../components/styles';
import { coordinateLogout } from '../logout-coordinator';
import { homeModel } from '../models';
import type { MovementType } from '../activity-recorder-core';
import { AuthFailure } from '../auth-failure';

const fallbackQuests: readonly QuestSummary[] = [homeModel.nearbyQuest];
type RemoteState = 'loading' | 'ready' | 'empty' | 'offline' | 'error';

const progress = (actual: number, goal: number | undefined) =>
  goal ? Math.min(100, Math.round((actual / goal) * 100)) : 0;
const goalLabel = (goal: WeeklyGoalResponse) => {
  const distance = goal.distanceMeters;
  const minutes = goal.activeMinutes;
  if (distance.goal)
    return `${(distance.actual / 1000).toFixed(1)} of ${(distance.goal / 1000).toFixed(1)} km`;
  if (minutes.goal) return `${minutes.actual} of ${minutes.goal} active min`;
  return 'Set a gentle weekly goal';
};
const isOffline = (error: unknown) =>
  error instanceof AuthFailure && ['network', 'tls'].includes(error.kind);
const useWeeklyGoal = (api: MobileApiClient) => {
  const [goal, setGoal] = useState<WeeklyGoalResponse>();
  const [state, setState] = useState<RemoteState>('loading');
  const load = async () => {
    setState('loading');
    try {
      const next = await api.getWeeklyGoal();
      setGoal(next);
      setState(next.activeMinutes.goal || next.distanceMeters.goal ? 'ready' : 'empty');
    } catch (error) {
      setState(isOffline(error) ? 'offline' : 'error');
    }
  };
  useEffect(() => {
    void load();
  }, [api]);
  return { goal, state, load, setGoal, setState };
};

export function HomeScreen({
  api,
  movement,
  onMovementChange,
  onStart,
  onOpenQuests,
  onOpenProfile
}: {
  api: MobileApiClient;
  movement: MovementType;
  onMovementChange: (movement: MovementType) => void;
  onStart: () => void;
  onOpenQuests: () => void;
  onOpenProfile: () => void;
}) {
  const styles = useAppStyles();
  const { dailyPath, member, nearbyQuest } = homeModel;
  const { goal, state: goalState } = useWeeklyGoal(api);
  const completed = goal
    ? Math.max(
        progress(goal.activeMinutes.actual, goal.activeMinutes.goal),
        progress(goal.distanceMeters.actual, goal.distanceMeters.goal)
      )
    : 0;
  return (
    <>
      <View style={styles.header}>
        <View style={styles.flexCopy}>
          <Text style={styles.eyebrow}>{homeModel.dateLabel}</Text>
          <Text style={styles.homeTitle}>Where will you{`\n`}move today?</Text>
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
      <Text style={styles.mvpLabel}>MVP · ANDROID V1</Text>
      <MovementChoice selected={movement} onChoose={onMovementChange} />
      {goalState === 'loading' && (
        <View style={styles.mascotGuide}>
          <LoopMascot
            variant="loading"
            accessibility={{
              mode: 'meaningful',
              label: 'Loop is here while your weekly progress loads.'
            }}
            size={48}
          />
          <Text style={styles.rowDetail}>Getting your weekly progress ready.</Text>
        </View>
      )}
      <View style={styles.dailyCard}>
        <Text style={styles.cardEyebrow}>THIS WEEK</Text>
        <Text style={styles.cardTitle}>{goal ? goalLabel(goal) : 'Your progress'}</Text>
        <Text style={styles.cardCopy}>
          {goalState === 'loading'
            ? 'Loading private, validated progress…'
            : goalState === 'offline'
              ? 'Progress is unavailable offline. Your recorded activity remains on this device.'
              : goalState === 'empty'
                ? 'Choose a distance or active-time goal that feels good for you.'
                : 'Only validated activities count. Pace never changes your progress.'}
        </Text>
        <View
          style={styles.progressTrack}
          accessibilityLabel={`${completed}% of weekly goal complete`}
        >
          <View style={[styles.progressFill, { width: `${completed}%` }]} />
        </View>
        <View style={styles.progressMeta}>
          <Text style={styles.progressStrong}>
            {goalState === 'ready' ? `${completed}% complete` : 'Private by default'}
          </Text>
          <Pressable accessibilityRole="button" onPress={onOpenProfile}>
            <Text style={styles.cardAction}>
              {goalState === 'empty' ? 'Set goal ›' : 'View goals ›'}
            </Text>
          </Pressable>
        </View>
      </View>
      <View style={styles.recordCard}>
        <View style={styles.cardTopline}>
          <View>
            <Text style={styles.eyebrow}>TODAY'S QUEST</Text>
            <Text style={styles.sectionTitle}>{dailyPath.title}</Text>
          </View>
          <Text style={styles.activityBadge}>⌖</Text>
        </View>
        <Text style={styles.rowDetail}>
          Visit 3 green spaces. Any comfortable pace, any safe public path.
        </Text>
        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              { width: `${(dailyPath.found / dailyPath.total) * 100}%` }
            ]}
          />
        </View>
        <View style={styles.progressMeta}>
          <Text style={styles.rowTitle}>
            {dailyPath.found} of {dailyPath.total} places
          </Text>
          <Pressable accessibilityRole="button" onPress={onOpenQuests}>
            <Text style={styles.link}>View quest ›</Text>
          </Pressable>
        </View>
      </View>
      <View style={styles.recordCard}>
        <View style={styles.cardTopline}>
          <View>
            <Text style={styles.eyebrow}>FREE ACTIVITY</Text>
            <Text style={styles.sectionTitle}>Move your own way</Text>
          </View>
          <Text style={styles.activityBadge}>↗</Text>
        </View>
        <Text style={styles.rowDetail}>
          Records on this device first. Your exact route stays private.
        </Text>
        <PrimaryButton label={`Start ${movement}`} onPress={onStart} />
      </View>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Nearby for you</Text>
        <Pressable accessibilityRole="button" onPress={onOpenQuests}>
          <Text style={styles.link}>See all</Text>
        </Pressable>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`View ${nearbyQuest.title} quest`}
        onPress={onOpenQuests}
        style={styles.questCard}
      >
        <View style={styles.terrain}>
          <Text style={styles.distanceBadge}>
            {(nearbyQuest.distanceMeters / 1000).toFixed(1)} km
          </Text>
        </View>
        <View style={styles.questCopy}>
          <Text style={styles.questTitle}>{nearbyQuest.title}</Text>
          <Text style={styles.muted}>
            {nearbyQuest.accessibility} · {nearbyQuest.estimatedActiveMinutes} min ·{' '}
            {nearbyQuest.openHours.status}
          </Text>
          <Text style={styles.verified}>Verified public places · any pace</Text>
        </View>
      </Pressable>
    </>
  );
}

export function QuestScreen({ api, onStart }: { api: MobileApiClient; onStart: () => void }) {
  const styles = useAppStyles();
  const [quests, setQuests] = useState<readonly QuestSummary[]>(fallbackQuests);
  const [state, setState] = useState<RemoteState>('loading');
  const [selected, setSelected] = useState<QuestSummary>();
  const load = async () => {
    setState('loading');
    try {
      const result = await api.listQuests();
      setQuests(result);
      setState(result.length ? 'ready' : 'empty');
    } catch {
      setState('error');
    }
  };
  useEffect(() => {
    void load();
  }, [api]);
  if (selected)
    return (
      <QuestDetailScreen
        api={api}
        quest={selected}
        onBack={() => setSelected(undefined)}
        onStart={onStart}
      />
    );
  return (
    <>
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>EXPLORE</Text>
          <Text style={styles.homeTitle}>Find your next path</Text>
        </View>
        <Text accessibilityLabel="Quest filters" style={styles.iconButton}>
          ≡
        </Text>
      </View>
      <Text style={styles.mvpLabel}>MVP · ANDROID V1</Text>
      <View style={styles.filterRow} accessibilityRole="tablist">
        {['For you', 'Under 30 min', 'Step-free', 'Open now'].map((filter, index) => (
          <Text key={filter} style={[styles.filterChip, index === 0 && styles.filterChipActive]}>
            {filter}
          </Text>
        ))}
      </View>
      <View style={styles.notice} accessibilityLiveRegion="polite">
        <Text style={styles.noticeIcon}>✓</Text>
        <View style={styles.flexCopy}>
          <Text style={styles.noticeTitle}>Verified before you go</Text>
          <Text style={styles.noticeCopy}>
            Recommendations use reviewed public places, opening status, accessibility, and coarse
            area—not your pace.
          </Text>
        </View>
      </View>
      {state === 'loading' && (
        <Text accessibilityLiveRegion="polite" style={styles.privateNote}>
          Looking for nearby verified quests…
        </Text>
      )}
      {state === 'empty' && (
        <EmptyState
          title="No quests available yet"
          copy="Connect to discover reviewed public places, or start a private free activity."
        />
      )}
      {state === 'error' && (
        <ErrorState
          copy="We couldn't refresh quests. Saved recommendations remain available."
          onRetry={load}
        />
      )}
      {quests.map((quest, index) => (
        <QuestCard
          key={quest.id}
          quest={quest}
          featured={index === 0}
          onPress={() => setSelected(quest)}
        />
      ))}
      <PrimaryButton label="Start a free activity" onPress={onStart} />
    </>
  );
}

function QuestCard({
  quest,
  featured,
  onPress
}: {
  quest: QuestSummary;
  featured: boolean;
  onPress: () => void;
}) {
  const styles = useAppStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`View ${quest.title}`}
      onPress={onPress}
      style={styles.recordCard}
    >
      {featured && <View style={styles.questArt} />}
      <View style={styles.cardTopline}>
        <View style={styles.flexCopy}>
          <Text style={styles.eyebrow}>{featured ? 'RECOMMENDED' : 'VERIFIED ROUTE'}</Text>
          <Text style={styles.sectionTitle}>{quest.title}</Text>
        </View>
        <Text style={styles.openPill}>{quest.openHours.status.toUpperCase()}</Text>
      </View>
      <Text style={styles.rowDetail}>
        {(quest.distanceMeters / 1000).toFixed(1)} km · {quest.estimatedActiveMinutes} min · walk,
        run, or hike{`\n`}
        {quest.accessibility} · {quest.checkpointCount} flexible checkpoints
      </Text>
      <Text style={styles.link}>View quest ›</Text>
    </Pressable>
  );
}

function QuestDetailScreen({
  api,
  quest,
  onBack,
  onStart
}: {
  api: MobileApiClient;
  quest: QuestSummary;
  onBack: () => void;
  onStart: () => void;
}) {
  const styles = useAppStyles();
  const [detail, setDetail] = useState<QuestDetail>();
  const [state, setState] = useState<RemoteState>('loading');
  useEffect(() => {
    void api
      .getQuest(quest.id)
      .then((item) => {
        setDetail(item);
        setState('ready');
      })
      .catch(() => setState('offline'));
  }, [api, quest.id]);
  return (
    <>
      <View style={styles.profileHeader}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to quests"
          onPress={onBack}
          style={styles.backButton}
        >
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <Text style={styles.mvpLabel}>VERIFIED QUEST</Text>
        <View style={styles.backButton} />
      </View>
      <Text style={styles.homeTitle}>{quest.title}</Text>
      <Text style={styles.lead}>
        Explore reviewed public-space checkpoints in any order. Choose walking, running, or hiking.
      </Text>
      <View style={styles.resultStats}>
        <Stat
          label="DISTANCE"
          value={(quest.distanceMeters / 1000).toFixed(1)}
          suffix="km"
          detail="Approximate band"
        />
        <Stat
          label="TIME"
          value={`${quest.estimatedActiveMinutes}`}
          suffix="min"
          detail="At your pace"
        />
        <Stat label="STOPS" value={`${quest.checkpointCount}`} detail="Flexible" />
      </View>
      {state === 'loading' && (
        <Text style={styles.privateNote}>Loading reviewed checkpoint details…</Text>
      )}
      {state === 'offline' && (
        <ErrorState copy="Checkpoint details are offline. The quest summary is still available." />
      )}
      <SettingsGroup title="Quest checkpoints">
        {(detail?.checkpoints ?? []).map((checkpoint, index) => (
          <View key={checkpoint.id} style={styles.checkpoint}>
            <Text style={styles.checkpointNumber}>{index + 1}</Text>
            <View style={styles.flexCopy}>
              <Text style={styles.rowTitle}>{checkpoint.title}</Text>
              <Text style={styles.rowDetail}>
                {checkpoint.accessibility} · {checkpoint.openHours.status} ·{' '}
                {checkpoint.openHours.schedule}
              </Text>
            </View>
          </View>
        ))}
      </SettingsGroup>
      <View style={styles.notice}>
        <Text style={styles.noticeIcon}>⌖</Text>
        <View style={styles.flexCopy}>
          <Text style={styles.noticeTitle}>No prescribed route</Text>
          <Text style={styles.noticeCopy}>
            Checkpoint visits are confirmed after server validation. Exact live location is never
            public.
          </Text>
        </View>
      </View>
      <PrimaryButton label="Choose activity type" onPress={onStart} />
    </>
  );
}

export function ClubsScreen() {
  const styles = useAppStyles();
  return (
    <View style={styles.centeredState}>
      <Text style={styles.futureLabel}>COMING LATER · COOPERATIVE</Text>
      <Text style={styles.comingSoonTitle}>Clubs are coming later.</Text>
      <Text style={styles.comingSoonCopy}>
        Future relays will let people contribute private segments at any comfortable pace. There is
        no XP, exact live location, or active territory behavior.
      </Text>
      <View style={styles.notice}>
        <Text style={styles.noticeIcon}>⌁</Text>
        <View style={styles.flexCopy}>
          <Text style={styles.noticeTitle}>Private by design</Text>
          <Text style={styles.noticeCopy}>
            A club will see only consented completion summaries—not an exact route, live location,
            or speed.
          </Text>
        </View>
      </View>
    </View>
  );
}

export function SeasonScreen() {
  const styles = useAppStyles();
  return (
    <View style={styles.centeredState}>
      <Text style={styles.mvpLabel}>CONDITIONAL · FLAG OFF</Text>
      <Text style={styles.comingSoonTitle}>No territory season is active.</Text>
      <Text style={styles.comingSoonCopy}>
        Territory remains unavailable until a future enrollment flag opens. This app does not use H3
        or MapLibre, and no territory behavior runs while it is off.
      </Text>
      <View style={styles.notice}>
        <Text style={styles.noticeIcon}>⌖</Text>
        <View style={styles.flexCopy}>
          <Text style={styles.noticeTitle}>Explore quests instead</Text>
          <Text style={styles.noticeCopy}>
            Reviewed checkpoints and private validated activities are available now.
          </Text>
        </View>
      </View>
    </View>
  );
}

export function ProfileScreen({
  api,
  accountId,
  onLogoutComplete
}: {
  api: MobileApiClient;
  accountId: string | undefined;
  onLogoutComplete: () => void;
}) {
  const styles = useAppStyles();
  const [screen, setScreen] = useState<'profile' | 'safety' | 'goals'>('profile');
  const [visibility, setVisibility] = useState<'private' | 'followers'>('private');
  const [visibilityBusy, setVisibilityBusy] = useState(false);
  const [verificationStatus, setVerificationStatus] = useState('Not verified');
  const updateVisibility = async (next: 'private' | 'followers') => {
    setVisibilityBusy(true);
    try {
      setVisibility((await api.updateVisibility({ activityVisibility: next })).activityVisibility);
    } catch (error) {
      Alert.alert(
        'Visibility unchanged',
        error instanceof Error ? error.message : 'Try again when connected.'
      );
    } finally {
      setVisibilityBusy(false);
    }
  };
  const requestVerification = async () => {
    try {
      await api.requestEmailVerification();
      setVerificationStatus(
        'Email sent — verify it, then return to enable followers and safety contacts'
      );
    } catch (error) {
      Alert.alert(
        'Verification unavailable',
        error instanceof Error ? error.message : 'Try again when connected.'
      );
    }
  };
  const confirmLogout = () =>
    Alert.alert('Log out', 'This clears local secure tokens and queued activity metadata.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log out',
        style: 'destructive',
        onPress: () =>
          void coordinateLogout({
            api,
            auth: authStorage,
            queue: activityQueue,
            ...(accountId
              ? { recorder: { clear: () => activityRecorder.clearAccount(accountId) } }
              : {})
          })
            .then(onLogoutComplete)
            .catch(() =>
              Alert.alert(
                'Unable to log out',
                'RunSphere could not clear all local account data. Please try again.'
              )
            )
      }
    ]);
  const requestExport = async () => {
    try {
      const exportResult = await api.exportAccount();
      Alert.alert(
        'Export ready',
        `Generated ${new Date(exportResult.generatedAt).toLocaleString()}. Raw traces are ${exportResult.rawTraceAvailability.replaceAll('-', ' ')}.`
      );
    } catch (error) {
      Alert.alert(
        'Export unavailable',
        error instanceof Error ? error.message : 'Try again when connected.'
      );
    }
  };
  const confirmDelete = () =>
    Alert.alert(
      'Schedule account deletion?',
      'Your profile becomes private and active safety shares are revoked. This cannot be undone from the app.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Schedule deletion',
          style: 'destructive',
          onPress: () =>
            void api
              .requestAccountDeletion()
              .then(async () => {
                await clearAccountData(
                  activityQueue,
                  authStorage,
                  accountId ? { clear: () => activityRecorder.clearAccount(accountId) } : undefined
                );
                Alert.alert('Deletion scheduled', 'Local account data has been cleared.');
                onLogoutComplete();
              })
              .catch((error) =>
                Alert.alert(
                  'Deletion unavailable',
                  error instanceof Error ? error.message : 'Try again when connected.'
                )
              )
        }
      ]
    );
  if (screen === 'safety') return <SafetyScreen api={api} onBack={() => setScreen('profile')} />;
  if (screen === 'goals') return <GoalsScreen api={api} onBack={() => setScreen('profile')} />;
  return (
    <>
      <View style={styles.profileHead}>
        <View style={styles.bigAvatar}>
          <Text style={styles.bigAvatarText}>MH</Text>
        </View>
        <View style={styles.flexCopy}>
          <Text style={styles.profileName}>Maya Hart</Text>
          <Text style={styles.muted}>@mayamoves · Mumbai</Text>
          <Text style={styles.mvpLabel}>PRIVATE PROFILE</Text>
        </View>
      </View>
      <SettingsGroup title="Goals & activity">
        <Setting
          label="Weekly progress"
          value="Set your own pace"
          onPress={() => setScreen('goals')}
        />
        <Setting label="Activity history" value="Private on this device" disabled />
      </SettingsGroup>
      <SettingsGroup title="Account visibility">
        <Setting
          label="Email verification"
          value={verificationStatus}
          onPress={() => void requestVerification()}
        />
        <Setting
          label="Default visibility"
          value={visibilityBusy ? 'Saving…' : visibility === 'private' ? 'Only me' : 'Followers'}
          onPress={() => void updateVisibility(visibility === 'private' ? 'followers' : 'private')}
        />
        <Text style={styles.settingsHint}>
          Verify your email before choosing followers. Exact routes still stay private.
        </Text>
      </SettingsGroup>
      <SettingsGroup title="Privacy & safety">
        <Setting
          label="Safety & privacy"
          value="Private by default"
          onPress={() => setScreen('safety')}
        />
      </SettingsGroup>
      <SettingsGroup title="Data">
        <Setting
          label="Export your data"
          value="Generate a private copy"
          onPress={() => void requestExport()}
        />
        <Setting label="Log out" value="Clear this device" onPress={confirmLogout} />
        <Setting
          label="Delete account"
          value="Schedule deletion"
          destructive
          onPress={confirmDelete}
        />
      </SettingsGroup>
    </>
  );
}

function GoalsScreen({ api, onBack }: { api: MobileApiClient; onBack: () => void }) {
  const styles = useAppStyles();
  const { tokens } = useAppTheme();
  const { goal, state, load, setGoal, setState } = useWeeklyGoal(api);
  const [minutes, setMinutes] = useState('150');
  const [distance, setDistance] = useState('5');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!goal) return;
    setMinutes(goal.activeMinutes.goal?.toString() ?? '');
    setDistance(goal.distanceMeters.goal ? (goal.distanceMeters.goal / 1000).toString() : '');
  }, [goal]);
  const save = async () => {
    const activeMinutes = Number(minutes);
    const distanceMeters = Math.round(Number(distance) * 1000);
    if (!activeMinutes && !distanceMeters) {
      Alert.alert('Add a goal', 'Choose active minutes, distance, or both.');
      return;
    }
    setSaving(true);
    try {
      setGoal(
        await api.saveWeeklyGoal({
          ...(activeMinutes ? { activeMinutes } : {}),
          ...(distanceMeters ? { distanceMeters } : {})
        })
      );
      setState('ready');
    } catch (error) {
      Alert.alert(
        'Goal not saved',
        error instanceof Error ? error.message : 'Try again when connected.'
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <BackHeader label="WEEKLY GOALS" onBack={onBack} />
      <Text style={styles.homeTitle}>Progress at your pace</Text>
      <Text style={styles.lead}>
        Only validated activity counts. There are no speed or calorie rewards.
      </Text>
      {state === 'loading' && <Text style={styles.privateNote}>Loading weekly progress…</Text>}
      {state === 'error' && <ErrorState copy="We couldn't load your goal." onRetry={load} />}
      {goal && (
        <View style={styles.resultStats}>
          <Stat
            label="ACTIVE MIN"
            value={`${goal.activeMinutes.actual}`}
            suffix={goal.activeMinutes.goal ? `/${goal.activeMinutes.goal}` : ''}
            detail="Validated"
          />
          <Stat
            label="DISTANCE"
            value={(goal.distanceMeters.actual / 1000).toFixed(1)}
            suffix="km"
            detail={
              goal.distanceMeters.goal
                ? `of ${(goal.distanceMeters.goal / 1000).toFixed(1)} km`
                : 'Validated'
            }
          />
        </View>
      )}
      <Text style={styles.fieldLabel}>WEEKLY ACTIVE MINUTES</Text>
      <TextInput
        accessibilityLabel="Weekly active minutes"
        keyboardType="number-pad"
        value={minutes}
        onChangeText={setMinutes}
        style={styles.input}
        placeholder="e.g. 150"
        placeholderTextColor={tokens.text.secondary}
      />
      <Text style={styles.fieldLabel}>WEEKLY DISTANCE IN KILOMETRES</Text>
      <TextInput
        accessibilityLabel="Weekly distance in kilometres"
        keyboardType="decimal-pad"
        value={distance}
        onChangeText={setDistance}
        style={styles.input}
        placeholder="e.g. 5"
        placeholderTextColor={tokens.text.secondary}
      />
      <PrimaryButton
        label={saving ? 'Saving…' : 'Save weekly goal'}
        disabled={saving}
        onPress={() => void save()}
      />
    </>
  );
}

function SafetyScreen({ api, onBack }: { api: MobileApiClient; onBack: () => void }) {
  const styles = useAppStyles();
  const { tokens } = useAppTheme();
  const [mapPreview, setMapPreview] = useState(true);
  const [zoneName, setZoneName] = useState('Home');
  const [zoneStatus, setZoneStatus] = useState('No saved zones this session');
  const [contactEmail, setContactEmail] = useState('');
  const [contacts, setContacts] = useState<readonly SafetyContactResponse[]>([]);
  const [state, setState] = useState<RemoteState>('loading');
  const [shareStatus, setShareStatus] = useState('Off by default for every activity');
  const loadContacts = async () => {
    try {
      const next = await api.listSafetyContacts();
      setContacts(next);
      setState(next.length ? 'ready' : 'empty');
    } catch {
      setState('offline');
    }
  };
  useEffect(() => {
    void loadContacts();
  }, [api]);
  const saveZone = async () => {
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        setZoneStatus('Location permission is needed to set the fixed center.');
        return;
      }
      const center = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced
      });
      const zone = await api.createPrivacyZone({
        name: zoneName.trim() || 'Saved place',
        center: center.coords
      });
      setZoneStatus(
        `${zone.name}: fixed ${zone.radiusMeters} m privacy zone saved and server enforced.`
      );
    } catch (error) {
      setZoneStatus(error instanceof Error ? error.message : 'Could not save the privacy zone.');
    }
  };
  const invite = async () => {
    try {
      const contact = await api.inviteSafetyContact({ email: contactEmail.trim() });
      setContacts((current) => [contact, ...current]);
      setContactEmail('');
      setState('ready');
    } catch (error) {
      Alert.alert(
        'Invitation unavailable',
        error instanceof Error ? error.message : 'Both accounts must be verified and trusted.'
      );
    }
  };
  const acceptContact = async (contact: SafetyContactResponse) => {
    try {
      await api.acceptSafetyContact(contact.id);
      await loadContacts();
    } catch (error) {
      Alert.alert(
        'Acceptance unavailable',
        error instanceof Error
          ? error.message
          : 'Open the invitation while signed in to the invited account.'
      );
    }
  };
  const startShare = async (contact: SafetyContactResponse) => {
    try {
      const share = await api.startSafetyShare({
        safetyContactId: contact.id,
        durationMinutes: 60
      });
      setShareStatus(
        `Active for 60 min · ${share.delayMinutes} min delay · ${share.tileSizeMeters} m tiles`
      );
    } catch (error) {
      Alert.alert(
        'Share unavailable',
        error instanceof Error ? error.message : 'An accepted, verified safety contact is required.'
      );
    }
  };
  return (
    <>
      <BackHeader label="SETTINGS" onBack={onBack} />
      <Text style={styles.homeTitle}>Safety & privacy</Text>
      <Text style={styles.mvpLabel}>MVP · ANDROID V1</Text>
      <SettingsGroup title="Activity privacy">
        <View style={styles.settingStack}>
          <Text style={styles.rowTitle}>Fixed-center privacy zone</Text>
          <Text style={styles.rowDetail}>
            Every zone has a fixed 200 m radius. The server trims it from eligible route output.
          </Text>
          <TextInput
            accessibilityLabel="Privacy zone name"
            value={zoneName}
            onChangeText={setZoneName}
            style={styles.input}
            placeholder="Place name"
            placeholderTextColor={tokens.text.secondary}
          />
          <PrimaryButton label="Save my current center" onPress={() => void saveZone()} />
          <Text accessibilityLiveRegion="polite" style={styles.privateNote}>
            {zoneStatus}
          </Text>
        </View>
        <View style={styles.setting}>
          <View style={styles.flexCopy}>
            <Text style={styles.rowTitle}>Shareable map preview</Text>
            <Text style={styles.rowDetail}>Hide if trimming leaves too little route</Text>
          </View>
          <Switch
            accessibilityLabel="Shareable map preview"
            value={mapPreview}
            onValueChange={setMapPreview}
            trackColor={{ false: tokens.border.subtle, true: tokens.status.success }}
          />
        </View>
      </SettingsGroup>
      <SettingsGroup title="Verified safety contact">
        <Text style={styles.settingsHint}>
          Safety invitations require verified, trusted accounts. A contact never receives exact
          coordinates, exact route, or access to past activities.
        </Text>
        <TextInput
          accessibilityLabel="Safety contact email"
          autoCapitalize="none"
          keyboardType="email-address"
          value={contactEmail}
          onChangeText={setContactEmail}
          style={styles.input}
          placeholder="contact@example.com"
          placeholderTextColor={tokens.text.secondary}
        />
        <PrimaryButton label="Invite verified contact" onPress={() => void invite()} />
        {state === 'loading' && <Text style={styles.privateNote}>Loading safety contacts…</Text>}
        {state === 'offline' && (
          <ErrorState copy="Safety contacts are unavailable offline." onRetry={loadContacts} />
        )}
        {contacts.map((contact) => (
          <View key={contact.id} style={styles.contactRow}>
            <View style={styles.flexCopy}>
              <Text style={styles.rowTitle}>{contact.email}</Text>
              <Text style={styles.rowDetail}>
                {contact.status === 'accepted'
                  ? 'Verified contact accepted'
                  : 'Invitation pending acceptance'}
              </Text>
            </View>
            {contact.status === 'accepted' ? (
              <Pressable accessibilityRole="button" onPress={() => void startShare(contact)}>
                <Text style={styles.link}>Start share</Text>
              </Pressable>
            ) : (
              <Pressable accessibilityRole="button" onPress={() => void acceptContact(contact)}>
                <Text style={styles.link}>Accept invite</Text>
              </Pressable>
            )}
          </View>
        ))}
        <View style={styles.notice}>
          <Text style={styles.noticeIcon}>⌖</Text>
          <View style={styles.flexCopy}>
            <Text style={styles.noticeTitle}>Delayed coarse sharing</Text>
            <Text style={styles.noticeCopy}>
              {shareStatus}. Locations are always at least 15 minutes delayed and 500 m or coarser.
            </Text>
          </View>
        </View>
      </SettingsGroup>
      <SettingsGroup title="Permissions & data">
        <Setting
          label="Precise location"
          value="While recording only"
          onPress={() => void Linking.openSettings()}
        />
        <Setting
          label="Motion & fitness"
          value="Optional"
          onPress={() => void Linking.openSettings()}
        />
      </SettingsGroup>
      <Text style={styles.safetyFooter}>
        RunSphere is not an emergency service. Contact local services if you are in immediate
        danger.
      </Text>
    </>
  );
}

function BackHeader({ label, onBack }: { label: string; onBack: () => void }) {
  const styles = useAppStyles();
  return (
    <View style={styles.profileHeader}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Go back"
        onPress={onBack}
        style={styles.backButton}
      >
        <Text style={styles.backText}>‹</Text>
      </Pressable>
      <Text style={styles.eyebrow}>{label}</Text>
      <View style={styles.backButton} />
    </View>
  );
}
function EmptyState({ title, copy }: { title: string; copy: string }) {
  const styles = useAppStyles();
  return (
    <View style={styles.notice}>
      <Text style={styles.noticeIcon}>⌁</Text>
      <View style={styles.flexCopy}>
        <Text style={styles.noticeTitle}>{title}</Text>
        <Text style={styles.noticeCopy}>{copy}</Text>
      </View>
    </View>
  );
}
function ErrorState({ copy, onRetry }: { copy: string; onRetry?: () => void }) {
  const styles = useAppStyles();
  return (
    <View style={[styles.notice, styles.warningNotice]}>
      <Text style={styles.noticeIcon}>!</Text>
      <View style={styles.flexCopy}>
        <Text style={styles.noticeTitle}>Something needs attention</Text>
        <Text style={styles.noticeCopy}>{copy}</Text>
        {onRetry && (
          <Pressable accessibilityRole="button" onPress={onRetry}>
            <Text style={styles.link}>Try again</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}
