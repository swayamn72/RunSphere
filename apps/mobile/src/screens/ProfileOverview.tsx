import type { ProgressionSummary } from '@runsphere/contracts';
import { Pressable, View } from 'react-native';
import { AchievementArt, TurfPointsMark } from '../components/ProgressionArtwork';
import { Text } from '../components/Text';
import { SettingsButton } from '../components/SettingsButton';
import { useAppStyles } from '../components/styles';
import { progressionPresentation } from './home-progression-model';
import { type AchievementMedallion, type ProfileStatCell } from './profile-overview-model';

/**
 * The profile overview: identity, weekly figures, and the
 * achievements the server has awarded.
 *
 * These are renderers over presentation objects. Nothing here derives a
 * number, which is what keeps the "no lifetime totals, no ranking" rule in
 * `profile-overview-model` from having to be restated per view.
 */
export function ProfileIdentityHead({
  name,
  initials,
  handle,
  tier,
  onEdit,
  onOpenSettings
}: {
  name: string;
  initials: string;
  /** The @username, once loaded (ADR-0014). */
  handle?: string;
  tier?: string;
  onEdit: () => void;
  onOpenSettings: () => void;
}) {
  const styles = useAppStyles();
  return (
    <View style={styles.profileHeader}>
      <View style={[styles.profileHead, styles.flexCopy]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Edit your display name"
          onPress={onEdit}
          style={({ pressed }) => [styles.bigAvatar, pressed && styles.buttonPressed]}
        >
          <Text style={styles.bigAvatarText}>{initials}</Text>
        </Pressable>
        <Text accessibilityRole="header" style={styles.profileName}>
          {name}
        </Text>
        {handle ? <Text style={styles.profileHandle}>{`@${handle}`}</Text> : null}
        {tier && <Text style={styles.profileHandle}>{tier}</Text>}
      </View>
      <SettingsButton onPress={onOpenSettings} />
    </View>
  );
}

export function ProfileLevel({ summary }: { summary: ProgressionSummary }) {
  const styles = useAppStyles();
  const { level, totalXpLabel } = progressionPresentation(summary, undefined);
  const progress = level?.progress;
  return (
    <View style={styles.profileLevelCard}>
      <View style={styles.profileLevelHeader}>
        <Text accessibilityRole="header" style={styles.profileStatValue}>
          {level?.levelLabel ?? 'Runner XP'}
        </Text>
        <Text style={styles.statTileSuffix}>{totalXpLabel} total</Text>
      </View>
      {progress !== undefined && (
        <View
          accessibilityRole="progressbar"
          accessibilityLabel="Progress to next level"
          accessibilityValue={{ min: 0, max: 100, now: progress }}
          style={styles.progressTrack}
        >
          <View style={[styles.progressFill, { width: `${progress}%` }]} />
        </View>
      )}
      {level && (
        <Text style={styles.statTileSuffix}>
          {level.terminal ? 'Top level reached' : level.xpInLevelLabel}
        </Text>
      )}
    </View>
  );
}

export function ProfileStats({ cells }: { cells: readonly ProfileStatCell[] }) {
  const styles = useAppStyles();
  if (!cells.length) return null;
  return (
    <>
      {cells.map((cell) => (
        <View key={cell.key} style={styles.profileTurfCard}>
          <TurfPointsMark size={48} />
          <View style={styles.flexCopy}>
            <Text style={styles.statTileSuffix}>{cell.label}</Text>
            <Text style={styles.profileStatValue}>{cell.value}</Text>
          </View>
        </View>
      ))}
    </>
  );
}

export function AchievementStrip({
  medallions,
  earnedCount,
  onViewAll
}: {
  medallions: readonly AchievementMedallion[];
  earnedCount: number;
  onViewAll: () => void;
}) {
  const styles = useAppStyles();
  return (
    <>
      <View style={styles.sectionHeader}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          Achievements
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="View all achievements"
          onPress={onViewAll}
        >
          <Text style={styles.link}>View all</Text>
        </Pressable>
      </View>
      {medallions.length ? (
        <View style={styles.tierRow}>
          {medallions.map((medallion) => (
            <View
              key={medallion.key}
              accessible
              accessibilityLabel={medallion.accessibilityLabel}
              style={styles.tierCell}
            >
              <View style={styles.tierBadge}>
                <AchievementArt achievementKey={medallion.achievementKey} />
              </View>
              <Text numberOfLines={2} style={styles.tierBadgeLabel}>
                {medallion.label}
              </Text>
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.muted}>No achievements yet. They arrive as you run.</Text>
      )}
      {earnedCount > medallions.length && (
        <Text style={styles.settingsHint}>{`${earnedCount - medallions.length} more earned.`}</Text>
      )}
    </>
  );
}
