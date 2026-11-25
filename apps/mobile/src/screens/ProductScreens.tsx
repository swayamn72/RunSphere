import { useCallback, useEffect, useState } from 'react';
import { failureMessage } from '../failure-copy';
import { PrivacyZoneList } from './PrivacyZoneList';
import { SharedWithYou } from './SharedWithYou';
import { PrivacySettingsScreen } from './PrivacySettingsScreen';
import { legalLinks } from './legal-model';
import { AccountRecoveryScreen } from './AccountRecoveryScreen';
import { Alert, Linking, Pressable, Switch, View } from 'react-native';
import { BottomSheet } from '../components/BottomSheet';
import { Text, TextInput } from '../components/Text';
import * as Location from 'expo-location';
import type {
  Profile,
  ProgressionSummary,
  Sanction,
  PrivacyZoneResponse,
  SafetyContactResponse,
  TerritoryClaimSummary,
  WeeklyGoalResponse
} from '@runsphere/contracts';
import type { MobileApiClient } from '../api-client';
import { clearAccountData } from '../account-cleanup';
import { activityQueue } from '../activity-queue.native';
import { activityRecorder } from '../activity-recorder.native';
import { authStorage } from '../auth-storage.native';
import { BackHeader, PrimaryButton, Setting, SettingsGroup, Stat } from '../components/primitives';
import { AppearanceSettings } from './AppearanceSettings';
import { useAppTheme } from '../theme/theme';
import { useAppStyles } from '../components/styles';
import { coordinateLogout } from '../logout-coordinator';
import { homeErrorState, type HomeRemoteState, weeklyGoalState } from './home-state';
import { AchievementsScreen } from './AchievementsScreen';
import { ClubsScreen } from './ClubsScreen';
import { NotificationsScreen } from './NotificationsScreen';
import { ProfileIdentityScreen } from './ProfileIdentityScreen';
import type { NotificationTarget } from './notifications-model';
import { profileInitials, profileNameLabel } from './profile-model';
import { AchievementStrip, ProfileIdentityHead, ProfileStats } from './ProfileOverview';
import { RunLogSection } from './RunLogSection';
import { useOpenRun } from './RunDetailHost';
import {
  achievementMedallions,
  FAIR_PLAY_PRIVACY,
  profileStatCells
} from './profile-overview-model';
import {
  DELETION_DONE_MESSAGE,
  DELETION_DONE_TITLE,
  DELETION_EXPLANATION,
  DELETION_RETENTION_NOTE,
  DELETION_TITLE,
  canSubmitDeletion,
  deletionFailure
} from './account-deletion-model';
import {
  APPEAL_CONSEQUENCE,
  NO_SANCTIONS_MESSAGE,
  appealFailureNotice,
  sanctionRows,
  validateAppeal
} from './moderation-model';

type RemoteState = HomeRemoteState;

/**
 * The account's own moderation record (milestone 3.7).
 *
 * Loaded quietly: an account with nothing against it sees one reassuring line
 * rather than a section that looks like an accusation, and a failure leaves the
 * section out entirely rather than implying something exists that cannot be
 * read.
 */
const useSanctions = (api: MobileApiClient) => {
  const [sanctions, setSanctions] = useState<readonly Sanction[]>([]);
  const [loaded, setLoaded] = useState(false);
  const reload = () => {
    void api
      .listSanctions()
      .then((next) => {
        setSanctions(next);
        setLoaded(true);
      })
      .catch(() => setLoaded(false));
  };
  useEffect(() => {
    let active = true;
    void api
      .listSanctions()
      .then((next) => {
        if (!active) return;
        setSanctions(next);
        setLoaded(true);
      })
      .catch(() => {
        if (active) setLoaded(false);
      });
    return () => {
      active = false;
    };
  }, [api]);
  return { sanctions, loaded, reload };
};

const useWeeklyGoal = (api: MobileApiClient) => {
  const [goal, setGoal] = useState<WeeklyGoalResponse>();
  const [state, setState] = useState<RemoteState>('loading');
  const load = useCallback(async () => {
    setState('loading');
    try {
      const next = await api.getWeeklyGoal();
      setGoal(next);
      setState(weeklyGoalState(next));
    } catch (error) {
      setState(homeErrorState(error) === 'offline' ? 'offline' : 'error');
    }
  }, [api]);
  useEffect(() => {
    void load();
  }, [load]);
  return { goal, state, load, setGoal, setState };
};

export function ProfileScreen({
  api,
  accountId,
  onLogoutComplete,
  onReplayTour,
  onNavigate,
  status,
  history,
  initialScreen = 'profile'
}: {
  api: MobileApiClient;
  accountId: string | undefined;
  onLogoutComplete: () => void;
  /** Starts the guided tour again (M9 9.21, 9.25). */
  onReplayTour?: () => void;
  /** Leaves the Profile tab for a destination an inbox entry points at. */
  onNavigate?: (target: NotificationTarget) => void;
  /** The level and XP chip, shown on the overview only (component plan §4.1). */
  status?: React.ReactNode;
  /** The on-this-phone activity list, shown under the overview only, not under every sub-screen. */
  history?: React.ReactNode;
  /**
   * Opens straight onto one of the sub-screens. The dashboard's bell arrives
   * here on `notifications`, so the inbox is one tap away rather than three.
   */
  initialScreen?: 'profile' | 'notifications' | 'settings' | 'privacy';
}) {
  const styles = useAppStyles();
  const { tokens } = useAppTheme();
  const [screen, setScreen] = useState<
    | 'profile'
    | 'settings'
    | 'safety'
    | 'privacy'
    | 'change-email'
    | 'goals'
    | 'identity'
    | 'notifications'
    | 'achievements'
    | 'clubs'
    | 'delete-account'
  >(initialScreen);
  // The profile is the only identity a social surface may show, and an account
  // without one is invisible to friends: a 404 here is a normal "unset" state.
  const [profile, setProfile] = useState<Profile>();
  const [handle, setHandle] = useState<string>();
  const legal = legalLinks((page) => api.legalPageUrl(page));
  useEffect(() => {
    let active = true;
    void api
      .getIdentity()
      .then((identity) => {
        if (active) setHandle(identity.username);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [api, screen]);
  useEffect(() => {
    let active = true;
    void api
      .getProfile()
      .then((next) => {
        if (active) setProfile(next);
      })
      .catch(() => {
        if (active) setProfile(undefined);
      });
    return () => {
      active = false;
    };
  }, [api, screen]);
  /**
   * The cosmetic level band and the week's figures shown above the settings.
   *
   * Both are optional decoration on a screen whose job is the account: a
   * failure leaves the card out rather than blocking identity or settings, and
   * neither is ever projected locally (ADR-0005).
   */
  const [progression, setProgression] = useState<ProgressionSummary>();
  const [overviewTurf, setOverviewTurf] = useState<TerritoryClaimSummary>();
  useEffect(() => {
    let active = true;
    void api
      .getProgressionSummary()
      .then((next) => {
        if (active) setProgression(next);
      })
      .catch(() => {
        if (active) setProgression(undefined);
      });
    void Promise.resolve()
      .then(() => api.getTerritoryClaimSummary())
      .then((next) => {
        if (active) setOverviewTurf(next);
      })
      .catch(() => {
        if (active) setOverviewTurf(undefined);
      });
    return () => {
      active = false;
    };
  }, [api, screen]);
  const loadRunLog = useCallback((cursor?: string) => api.getRunLog(cursor), [api]);
  const openRun = useOpenRun();
  const { sanctions, loaded: sanctionsLoaded, reload: reloadSanctions } = useSanctions(api);
  const [appealDrafts, setAppealDrafts] = useState<Readonly<Record<string, string>>>({});
  const [appealNotice, setAppealNotice] = useState('');
  const [appealBusy, setAppealBusy] = useState(false);
  const [fairPlayOpen, setFairPlayOpen] = useState(false);
  const [verificationStatus, setVerificationStatus] = useState('Not verified');
  const sendAppeal = async (sanctionId: string) => {
    const validation = validateAppeal(appealDrafts[sanctionId] ?? '');
    if (!validation.ok) {
      setAppealNotice(validation.message);
      return;
    }
    setAppealBusy(true);
    try {
      await api.appealSanction(sanctionId, validation.statement);
      setAppealNotice('Appeal sent. You will be told the decision and the reason for it.');
      setAppealDrafts((drafts) => ({ ...drafts, [sanctionId]: '' }));
      reloadSanctions();
    } catch (error) {
      setAppealNotice(appealFailureNotice(error));
    }
    setAppealBusy(false);
  };

  const requestVerification = async () => {
    try {
      await api.requestEmailVerification();
      setVerificationStatus(
        'Email sent — verify it, then return to enable followers and safety contacts'
      );
    } catch (error) {
      Alert.alert('Verification unavailable', failureMessage(error, 'Try again when connected.'));
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
                'TURFR could not clear all local account data. Please try again.'
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
      Alert.alert('Export unavailable', failureMessage(error, 'Try again when connected.'));
    }
  };
  if (screen === 'delete-account')
    return (
      <DeleteAccountScreen
        api={api}
        onBack={() => setScreen('settings')}
        onDeleted={async () => {
          // The server has already revoked every session; this clears what
          // the device itself holds for the account.
          await clearAccountData(
            activityQueue,
            authStorage,
            accountId ? { clear: () => activityRecorder.clearAccount(accountId) } : undefined
          );
          Alert.alert(DELETION_DONE_TITLE, DELETION_DONE_MESSAGE);
          onLogoutComplete();
        }}
        onSessionExpired={onLogoutComplete}
      />
    );
  if (screen === 'safety') return <SafetyScreen api={api} onBack={() => setScreen('profile')} />;
  if (screen === 'change-email')
    return (
      <AccountRecoveryScreen
        api={api}
        kind="change-email"
        onBack={() => setScreen('settings')}
        onDone={() => {
          setVerificationStatus('Email changed');
          setScreen('settings');
        }}
      />
    );
  if (screen === 'privacy')
    return (
      <PrivacySettingsScreen
        api={api}
        onBack={() => setScreen('profile')}
        onOpenSafety={() => setScreen('safety')}
      />
    );
  if (screen === 'goals') return <GoalsScreen api={api} onBack={() => setScreen('profile')} />;
  if (screen === 'identity')
    return (
      <ProfileIdentityScreen api={api} onBack={() => setScreen('profile')} onSaved={setProfile} />
    );
  if (screen === 'notifications')
    return (
      <NotificationsScreen
        api={api}
        onBack={() => setScreen('profile')}
        onOpenTarget={(target) => {
          setScreen('profile');
          onNavigate?.(target);
        }}
        onSessionExpired={onLogoutComplete}
      />
    );
  if (screen === 'achievements')
    return (
      <AchievementsScreen
        api={api}
        onBack={() => setScreen('profile')}
        onSessionExpired={onLogoutComplete}
      />
    );
  // Clubs have no tab in the five-tab bar, but ground can be held for one
  // (`TerritoryClaim.club`), so the screen that manages them has to be
  // reachable from somewhere. Settings is that somewhere.
  if (screen === 'clubs')
    return (
      <>
        <BackHeader label="CLUBS" onBack={() => setScreen('settings')} />
        <ClubsScreen api={api} accountId={accountId} onSessionExpired={onLogoutComplete} />
      </>
    );
  const settingsView = (
    <>
      <AppearanceSettings />
      <SettingsGroup title="Account">
        <Setting
          label="Display name"
          value={profile?.displayName ?? 'Not set'}
          onPress={() => setScreen('identity')}
        />
        <Setting
          label="Change email"
          value="Confirm with a link"
          onPress={() => setScreen('change-email')}
        />
        <Setting
          label="Email verification"
          value={verificationStatus}
          onPress={() => void requestVerification()}
        />
        <Text style={styles.settingsHint}>
          Who can see you and your runs is set under Privacy & safety. Exact routes still stay
          private.
        </Text>
      </SettingsGroup>
      <SettingsGroup title="Privacy & safety">
        <Setting
          label="Privacy & visibility"
          value="Who sees you"
          onPress={() => setScreen('privacy')}
        />
        <Setting
          label="Safety & privacy"
          value="Private by default"
          onPress={() => setScreen('safety')}
        />
        <Setting
          label="Fair Play & Privacy"
          value="GPS checks and what you share"
          onPress={() => setFairPlayOpen(true)}
        />
      </SettingsGroup>
      <BottomSheet
        visible={fairPlayOpen}
        title="Fair Play & Privacy"
        onClose={() => setFairPlayOpen(false)}
        actions={<PrimaryButton label="Done" onPress={() => setFairPlayOpen(false)} />}
      >
        {FAIR_PLAY_PRIVACY.map((detail) => (
          <Text key={detail} style={styles.lead}>
            {detail}
          </Text>
        ))}
      </BottomSheet>
      <SettingsGroup title="Friends and clubs">
        <Setting
          label="Notifications"
          value="Inbox and delivery"
          onPress={() => setScreen('notifications')}
        />
        <Setting label="Clubs" value="Create or join one" onPress={() => setScreen('clubs')} />
        <Text style={styles.settingsHint}>
          Friends see your display name, and your runs as you choose in Privacy & visibility. Manage
          friends and requests from the Social tab.
        </Text>
      </SettingsGroup>
      <SettingsGroup title="Goals & activity">
        <Setting
          label="Weekly progress"
          value="Set your own pace"
          onPress={() => setScreen('goals')}
        />
        <Setting
          label="Achievements"
          value="Cosmetic only"
          onPress={() => setScreen('achievements')}
        />
      </SettingsGroup>
      <SettingsGroup title="Your standing">
        {sanctionsLoaded && sanctions.length === 0 && (
          <Text style={styles.settingsHint}>{NO_SANCTIONS_MESSAGE}</Text>
        )}
        {appealNotice !== '' && <Text style={styles.settingsHint}>{appealNotice}</Text>}
        {sanctionRows(sanctions).map((row) => (
          <View
            key={row.id}
            accessible
            accessibilityLabel={row.accessibilityLabel}
            style={styles.settingStack}
          >
            <Text style={styles.rowTitle}>{`${row.kindLabel} · ${row.statusLabel}`}</Text>
            <Text style={styles.rowDetail}>{row.statement}</Text>
            <Text style={styles.settingsHint}>{row.effectLabel}</Text>
            <Text style={styles.settingsHint}>{row.endsLabel}</Text>
            {row.appealStatusLabel && (
              <Text style={styles.settingsHint}>{row.appealStatusLabel}</Text>
            )}
            {row.canAppeal && (
              <>
                <Text style={styles.settingsHint}>{APPEAL_CONSEQUENCE}</Text>
                <TextInput
                  accessibilityLabel={`Appeal the ${row.kindLabel.toLowerCase()}`}
                  multiline
                  onChangeText={(text) =>
                    setAppealDrafts((drafts) => ({ ...drafts, [row.id]: text }))
                  }
                  placeholder="What should a moderator know?"
                  placeholderTextColor={tokens.text.secondary}
                  style={styles.input}
                  value={appealDrafts[row.id] ?? ''}
                />
                <PrimaryButton
                  accessibilityLabel="Send appeal"
                  label={appealBusy ? 'Sending…' : 'Send appeal'}
                  disabled={appealBusy}
                  onPress={() => void sendAppeal(row.id)}
                />
              </>
            )}
          </View>
        ))}
      </SettingsGroup>
      <SettingsGroup title="Help">
        {onReplayTour ? (
          <Setting
            label="Replay the tour"
            value="Rho shows you around again"
            onPress={() => {
              setScreen('profile');
              onReplayTour();
            }}
          />
        ) : null}
      </SettingsGroup>
      <SettingsGroup title="Data and account">
        <Setting
          label="Export your data"
          value="Generate a private copy"
          onPress={() => void requestExport()}
        />
        <Setting label="Log out" value="Clear this device" onPress={confirmLogout} />
        <Setting
          label="Delete account"
          value="Permanent"
          destructive
          onPress={() => setScreen('delete-account')}
        />
      </SettingsGroup>
      {legal.length > 0 && (
        <SettingsGroup title="Legal">
          {legal.map((link) => (
            <Setting
              key={link.page}
              label={link.label}
              value={link.value}
              onPress={() => void Linking.openURL(link.url)}
            />
          ))}
        </SettingsGroup>
      )}
    </>
  );

  // Settings live behind the gear rather than under the overview: the profile
  // is something a person looks at, and a wall of account rows underneath it
  // buried the identity the screen exists to show.
  if (screen === 'settings')
    return (
      <>
        <BackHeader label="SETTINGS" onBack={() => setScreen('profile')} />
        {settingsView}
      </>
    );

  return (
    <>
      {status}
      <ProfileIdentityHead
        name={profileNameLabel(profile?.displayName)}
        initials={profileInitials(profile?.displayName)}
        {...(handle ? { handle } : {})}
        {...(profile?.cosmetic.tier ? { tier: profile.cosmetic.tier } : {})}
        onEdit={() => setScreen('identity')}
        onOpenSettings={() => setScreen('settings')}
      />
      <ProfileStats cells={profileStatCells(overviewTurf)} />
      <AchievementStrip
        medallions={achievementMedallions(progression?.achievements ?? [])}
        earnedCount={progression?.achievements.length ?? 0}
        onViewAll={() => setScreen('achievements')}
      />
      <RunLogSection
        load={loadRunLog}
        owner
        {...(openRun
          ? {
              onOpenRun: (item, origin, measureOrigin, onDeleted) =>
                openRun({ item, owner: true, origin, measureOrigin, onDeleted })
            }
          : {})}
      />
      {history}
    </>
  );
}

/**
 * In-app account deletion (ADR-0012). A dedicated screen rather than an alert
 * because Android alerts cannot hold a password field, and because a
 * permanent action deserves the full explanation in front of it.
 */
function DeleteAccountScreen({
  api,
  onBack,
  onDeleted,
  onSessionExpired
}: {
  api: MobileApiClient;
  onBack: () => void;
  onDeleted: () => Promise<void>;
  onSessionExpired: () => void;
}) {
  const styles = useAppStyles();
  const { tokens } = useAppTheme();
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<string>();
  const submit = async () => {
    if (!canSubmitDeletion(password, submitting)) return;
    setSubmitting(true);
    setFailure(undefined);
    try {
      await api.requestAccountDeletion(password);
    } catch (error) {
      const next = deletionFailure(error);
      setSubmitting(false);
      if (next.sessionExpired) {
        onSessionExpired();
        return;
      }
      setFailure(next.message);
      return;
    }
    setPassword('');
    await onDeleted();
  };
  return (
    <>
      <BackHeader label="DELETE ACCOUNT" onBack={onBack} />
      <Text style={styles.homeTitle}>{DELETION_TITLE}</Text>
      <Text style={styles.lead}>{DELETION_EXPLANATION}</Text>
      <Text style={styles.privateNote}>{DELETION_RETENTION_NOTE}</Text>
      <Text style={styles.fieldLabel}>CURRENT PASSWORD</Text>
      <TextInput
        accessibilityLabel="Current password"
        secureTextEntry
        autoCapitalize="none"
        autoComplete="current-password"
        textContentType="password"
        value={password}
        onChangeText={setPassword}
        style={styles.input}
        placeholderTextColor={tokens.text.secondary}
      />
      {failure && (
        <Text accessibilityRole="alert" style={styles.privateNote}>
          {failure}
        </Text>
      )}
      <PrimaryButton
        label={submitting ? 'Deleting…' : 'Delete my account permanently'}
        accessibilityLabel="Delete my account permanently"
        disabled={!canSubmitDeletion(password, submitting)}
        onPress={() => void submit()}
      />
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
      Alert.alert('Goal not saved', failureMessage(error, 'Try again when connected.'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <BackHeader label="WEEKLY GOALS" onBack={onBack} />
      <Text style={styles.homeTitle}>Progress at your pace</Text>
      <Text style={styles.lead}>
        Only checked runs count. There are no speed or calorie rewards.
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
  const [zoneStatus, setZoneStatus] = useState('');
  const [zones, setZones] = useState<readonly PrivacyZoneResponse[]>([]);
  const [activeShareId, setActiveShareId] = useState<string>();
  const [contactEmail, setContactEmail] = useState('');
  const [contacts, setContacts] = useState<readonly SafetyContactResponse[]>([]);
  const [state, setState] = useState<RemoteState>('loading');
  const [shareStatus, setShareStatus] = useState('Off by default for every activity');
  const loadContacts = useCallback(async () => {
    try {
      const next = await api.listSafetyContacts();
      setContacts(next);
      setState(next.length ? 'ready' : 'empty');
    } catch {
      setState('offline');
    }
  }, [api]);
  useEffect(() => {
    void loadContacts();
  }, [loadContacts]);
  const loadZones = useCallback(async () => {
    try {
      setZones(await api.listPrivacyZones());
    } catch (error) {
      setZoneStatus(failureMessage(error, "Couldn't load your zones. Try again."));
    }
  }, [api]);
  useEffect(() => {
    void loadZones();
  }, [loadZones]);
  const removeZone = async (zone: PrivacyZoneResponse) => {
    try {
      await api.deletePrivacyZone(zone.id);
      setZones((current) => current.filter((candidate) => candidate.id !== zone.id));
      setZoneStatus(`${zone.name} removed. Runs you record from now on aren't trimmed there.`);
    } catch (error) {
      setZoneStatus(failureMessage(error, "Couldn't remove that zone. Try again."));
    }
  };
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
      setZones((current) => [zone, ...current]);
      setZoneStatus(
        `${zone.name}: fixed ${zone.radiusMeters} m privacy zone saved. Your shared routes skip it.`
      );
    } catch (error) {
      setZoneStatus(failureMessage(error, 'Could not save the privacy zone.'));
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
        failureMessage(error, 'Both accounts must be verified and trusted.')
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
        failureMessage(error, 'Open the invitation while signed in to the invited account.')
      );
    }
  };
  const startShare = async (contact: SafetyContactResponse) => {
    try {
      const share = await api.startSafetyShare({
        safetyContactId: contact.id,
        durationMinutes: 60
      });
      setActiveShareId(share.id);
      setShareStatus(
        `Active for 60 min · ${share.delayMinutes} min delay · ${share.tileSizeMeters} m tiles`
      );
    } catch (error) {
      Alert.alert(
        'Share unavailable',
        failureMessage(error, 'An accepted, verified safety contact is required.')
      );
    }
  };
  const stopShare = async () => {
    if (!activeShareId) return;
    try {
      await api.stopSafetyShare(activeShareId);
      setActiveShareId(undefined);
      setShareStatus('Sharing stopped');
    } catch (error) {
      Alert.alert("Couldn't stop sharing", failureMessage(error, 'Try again in a moment.'));
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
            Every zone has a fixed 200 m radius. Routes you share are trimmed inside it.
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
          {zoneStatus ? (
            <Text accessibilityLiveRegion="polite" style={styles.privateNote}>
              {zoneStatus}
            </Text>
          ) : null}
          <PrivacyZoneList zones={zones} onRemove={(zone) => void removeZone(zone)} />
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
        <SharedWithYou api={api} />
        <Text style={styles.settingsHint}>
          Safety invitations require verified, trusted accounts. A contact never receives exact
          coordinates, exact route, or access to past activities.
        </Text>
        <View style={styles.settingStack}>
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
        </View>
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
        {activeShareId ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Stop sharing"
            onPress={() => void stopShare()}
          >
            <Text style={[styles.textButton, styles.destructive]}>Stop sharing</Text>
          </Pressable>
        ) : null}
      </SettingsGroup>
      <SettingsGroup title="Permissions & data">
        <Setting
          label="Precise location"
          value="While recording only"
          onPress={() => void Linking.openSettings()}
        />
      </SettingsGroup>
      <Text style={styles.safetyFooter}>
        TURFR is not an emergency service. Contact local services if you are in immediate danger.
      </Text>
    </>
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
