import { useEffect, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import type { QuestSummary } from '@runsphere/contracts';
import { colors } from '@runsphere/ui';
import type { MobileApiClient } from '../api-client';
import {
  MovementChoice,
  PrimaryButton,
  Setting,
  SettingsGroup,
  Stat
} from '../components/primitives';
import { styles } from '../components/styles';
import { clearAccountData } from '../account-cleanup';
import { activityQueue } from '../activity-queue.native';
import { activityRecorder } from '../activity-recorder.native';
import { authStorage } from '../auth-storage.native';
import { coordinateLogout } from '../logout-coordinator';
import { homeModel } from '../models';
import type { MovementType } from '../activity-recorder-core';

const fallbackQuests: readonly QuestSummary[] = [homeModel.nearbyQuest];

export function HomeScreen({
  movement,
  onMovementChange,
  onStart,
  onOpenQuests,
  onOpenProfile
}: {
  movement: MovementType;
  onMovementChange: (movement: MovementType) => void;
  onStart: () => void;
  onOpenQuests: () => void;
  onOpenProfile: () => void;
}) {
  const { dailyPath, member, nearbyQuest } = homeModel;
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
      <View style={styles.dailyCard}>
        <Text style={styles.cardEyebrow}>TODAY'S QUEST</Text>
        <Text style={styles.cardTitle}>{dailyPath.title}</Text>
        <Text style={styles.cardCopy}>
          Visit 3 green spaces. Any comfortable pace, any safe public path.
        </Text>
        <View style={styles.progressTrack}>
          <View style={styles.progressFill} />
        </View>
        <View style={styles.progressMeta}>
          <Text style={styles.progressStrong}>
            {dailyPath.found} of {dailyPath.total} places
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="View today's quest"
            onPress={onOpenQuests}
          >
            <Text style={styles.cardAction}>View quest ›</Text>
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
            {nearbyQuest.accessibility} · {nearbyQuest.estimatedActiveMinutes} min · open{' '}
            {nearbyQuest.openHours.status}
          </Text>
          <Text style={styles.verified}>Verified public places · any pace</Text>
        </View>
      </Pressable>
    </>
  );
}

export function QuestScreen({ api, onStart }: { api: MobileApiClient; onStart: () => void }) {
  const [quests, setQuests] = useState<readonly QuestSummary[]>(fallbackQuests);
  const [state, setState] = useState<'loading' | 'ready' | 'offline' | 'error'>('loading');
  const load = async () => {
    setState('loading');
    try {
      const result = await api.listQuests();
      setQuests(result);
      setState(result.length ? 'ready' : 'offline');
    } catch {
      setState('error');
    }
  };
  useEffect(() => {
    void load();
  }, []);
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
      {state === 'offline' && (
        <View style={styles.notice}>
          <Text style={styles.noticeIcon}>⌁</Text>
          <View style={styles.flexCopy}>
            <Text style={styles.noticeTitle}>No quests available yet</Text>
            <Text style={styles.noticeCopy}>
              Connect to the internet to discover verified places, or start a private free activity.
            </Text>
          </View>
        </View>
      )}
      {state === 'error' && (
        <View style={[styles.notice, styles.warningNotice]}>
          <Text style={styles.noticeIcon}>!</Text>
          <View style={styles.flexCopy}>
            <Text style={styles.noticeTitle}>We couldn't refresh quests</Text>
            <Text style={styles.noticeCopy}>
              Your saved recommendations are still available. Try again when you're connected.
            </Text>
            <Pressable accessibilityRole="button" onPress={() => void load()}>
              <Text style={styles.link}>Try again</Text>
            </Pressable>
          </View>
        </View>
      )}
      {quests.map((quest, index) => (
        <QuestCard key={quest.id} quest={quest} featured={index === 0} />
      ))}
      <PrimaryButton label="Start a free activity" onPress={onStart} />
    </>
  );
}

function QuestCard({ quest, featured }: { quest: QuestSummary; featured: boolean }) {
  return (
    <View style={styles.recordCard}>
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
    </View>
  );
}

export function ClubsScreen() {
  return (
    <View style={styles.centeredState}>
      <Text style={styles.futureLabel}>FUTURE · DEFERRED</Text>
      <Text style={styles.comingSoonTitle}>Clubs are coming later.</Text>
      <Text style={styles.comingSoonCopy}>
        Cooperative relays will let people contribute private segments at any comfortable pace.
        Clubs and live sharing are not available in v1.
      </Text>
      <View style={styles.notice}>
        <Text style={styles.noticeIcon}>⌁</Text>
        <View style={styles.flexCopy}>
          <Text style={styles.noticeTitle}>Private by design</Text>
          <Text style={styles.noticeCopy}>
            Future club features will not share exact routes or live locations.
          </Text>
        </View>
      </View>
    </View>
  );
}

export function SeasonScreen() {
  return (
    <View style={styles.centeredState}>
      <Text style={styles.mvpLabel}>CONDITIONAL · LATER MILESTONE</Text>
      <Text style={styles.comingSoonTitle}>Territory seasons are not active.</Text>
      <Text style={styles.comingSoonCopy}>
        When available, seasons will use aggregate cells and validated activity—not speed—to keep
        the experience fair.
      </Text>
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
  const [showSafety, setShowSafety] = useState(false);
  const confirmLogout = () =>
    Alert.alert('Log out', 'This clears local secure tokens and queued activity metadata.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log out',
        style: 'destructive',
        onPress: () => {
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
            );
        }
      }
    ]);
  const confirmDelete = () =>
    Alert.alert(
      'Delete account',
      'This clears local secure tokens and queued activity metadata. Account deletion remains a pilot-only placeholder.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete account',
          style: 'destructive',
          onPress: () => {
            void clearAccountData(
              activityQueue,
              authStorage,
              accountId ? { clear: () => activityRecorder.clearAccount(accountId) } : undefined
            ).then(() =>
              Alert.alert('Local data cleared', 'Secure tokens and queued metadata were removed.')
            );
          }
        }
      ]
    );
  if (showSafety) return <SafetyScreen onBack={() => setShowSafety(false)} />;
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
      <View style={styles.profileStats}>
        <Stat value="186" label="CELLS" detail="Validated" />
        <Stat value="28" label="QUESTS" detail="Completed" />
        <Stat value="9" label="WEEK STREAK" detail="At your pace" />
      </View>
      <SettingsGroup title="Activity preferences">
        <Setting label="Primary movement" value="Choose before recording" disabled />
        <Setting label="Accessibility" value="Coming soon" disabled />
      </SettingsGroup>
      <SettingsGroup title="Privacy & safety">
        <Setting
          label="Safety & privacy"
          value="Private by default"
          onPress={() => setShowSafety(true)}
        />
      </SettingsGroup>
      <SettingsGroup title="Data">
        <Setting label="Export your data" value="Coming soon" disabled />
        <Setting label="Log out" value="Clear this device" onPress={confirmLogout} />
        <Setting
          label="Delete account"
          value="Pilot placeholder"
          destructive
          onPress={confirmDelete}
        />
      </SettingsGroup>
    </>
  );
}

function SafetyScreen({ onBack }: { onBack: () => void }) {
  const [mapPreview, setMapPreview] = useState(true);
  return (
    <>
      <View style={styles.profileHeader}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to profile"
          onPress={onBack}
          style={styles.backButton}
        >
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <Text style={styles.eyebrow}>SETTINGS</Text>
        <View style={styles.backButton} />
      </View>
      <Text style={styles.homeTitle}>Safety & privacy</Text>
      <Text style={styles.mvpLabel}>MVP · ANDROID V1</Text>
      <SettingsGroup title="Activity privacy">
        <Setting label="Default visibility" value="Only me" disabled />
        <Setting label="Privacy zones" value="Server enforced later" disabled />
        <View style={styles.setting}>
          <View style={styles.flexCopy}>
            <Text style={styles.rowTitle}>Shareable map preview</Text>
            <Text style={styles.rowDetail}>Hide if trimming leaves too little route</Text>
          </View>
          <Switch
            accessibilityLabel="Shareable map preview"
            value={mapPreview}
            onValueChange={setMapPreview}
            trackColor={{ false: colors.line, true: colors.teal }}
          />
        </View>
      </SettingsGroup>
      <SettingsGroup title="Safety contact">
        <Setting label="Delayed coarse sharing" value="Off by default" disabled />
        <View style={styles.notice}>
          <Text style={styles.noticeIcon}>⌖</Text>
          <View style={styles.flexCopy}>
            <Text style={styles.noticeTitle}>At least 15 min delayed · 500 m or coarser</Text>
            <Text style={styles.noticeCopy}>
              A safety contact never receives exact coordinates, exact route, or past activities.
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

export function ProductScroll({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      {children}
    </ScrollView>
  );
}
