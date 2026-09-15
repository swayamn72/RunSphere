import { Pressable, Text, View } from 'react-native';
import { useAppStyles } from '../components/styles';
import { useAppTheme } from '../theme/theme';
import type { LevelPresentation } from './home-progression-model';
import type { AchievementMedallion, ProfileStatCell } from './profile-overview-model';

/**
 * The profile overview: identity, cosmetic level band, weekly figures, and the
 * achievements the server has awarded.
 *
 * All four are renderers over presentation objects. Nothing here derives a
 * number, which is what keeps the "no lifetime totals, no ranking" rule in
 * `profile-overview-model` from having to be restated per view.
 */
export function ProfileIdentityHead({
  name,
  initials,
  onEdit,
  onOpenSettings
}: {
  name: string;
  initials: string;
  onEdit: () => void;
  onOpenSettings: () => void;
}) {
  const styles = useAppStyles();
  return (
    <>
      <View style={styles.profileHeader}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Account settings"
          onPress={onOpenSettings}
          style={({ pressed }) => [styles.headerButton, pressed && styles.buttonPressed]}
        >
          <Text style={styles.headerButtonGlyph}>⚙</Text>
        </Pressable>
        <View />
      </View>
      <View style={styles.profileHead}>
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
      </View>
    </>
  );
}

/**
 * The cosmetic level band (ADR-0005).
 *
 * `level` is undefined when no progression rule is published, in which case the
 * XP total is shown on its own — a level 1 would be invented, and the bar has
 * no band to fill.
 */
export function LevelCard({
  totalXpLabel,
  level,
  tierLabel
}: {
  totalXpLabel: string;
  level: LevelPresentation | undefined;
  tierLabel: string | undefined;
}) {
  const styles = useAppStyles();
  return (
    <View style={styles.card}>
      <View style={styles.cardRow}>
        <View style={styles.flexCopy}>
          <Text style={styles.cardTitle}>
            {level ? `${level.levelLabel} · ${totalXpLabel}` : totalXpLabel}
          </Text>
          {level && <Text style={styles.rowDetail}>{level.xpInLevelLabel}</Text>}
        </View>
        {tierLabel && <Text style={styles.badge}>{tierLabel.toUpperCase()}</Text>}
      </View>
      {level?.progress !== undefined && (
        <View style={styles.challengeProgress}>
          <View
            accessibilityLabel={level.progressAccessibilityLabel}
            accessibilityRole="progressbar"
            accessibilityValue={{
              min: 0,
              max: 100,
              now: level.progress,
              text: `${level.progress}% of this level`
            }}
            style={styles.progressTrack}
          >
            <View style={[styles.progressFill, { width: `${level.progress}%` }]} />
          </View>
        </View>
      )}
      {!level && (
        <Text style={styles.rowDetail}>
          Cosmetic levels are not published yet, so only your XP total is available.
        </Text>
      )}
      <Text style={styles.settingsHint}>
        XP is cosmetic. It never changes quest eligibility, validation, or who you are matched with.
      </Text>
    </View>
  );
}

export function ProfileStats({ cells }: { cells: readonly ProfileStatCell[] }) {
  const styles = useAppStyles();
  if (!cells.length) return null;
  return (
    <View style={styles.statGrid}>
      {cells.map((cell) => (
        <View key={cell.key} style={styles.statTile}>
          <Text style={styles.statTileValue}>{cell.value}</Text>
          <Text style={styles.metricCellLabel}>{cell.label}</Text>
        </View>
      ))}
    </View>
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
  const { tokens } = useAppTheme();
  // A fixed rotation, so the three most recent awards stay distinguishable
  // without implying a tier the server has not published.
  const hues = [tokens.accent.gold, tokens.accent.violet, tokens.accent.azure];
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
          {medallions.map((medallion, index) => (
            <View
              key={medallion.key}
              accessible
              accessibilityLabel={medallion.accessibilityLabel}
              style={styles.tierCell}
            >
              <View
                style={[
                  styles.tierBadge,
                  { backgroundColor: (hues[index % hues.length] ?? tokens.accent.gold) + '26' }
                ]}
              >
                <Text
                  style={[
                    styles.tierBadgeGlyph,
                    { color: hues[index % hues.length] ?? tokens.accent.gold }
                  ]}
                >
                  ★
                </Text>
              </View>
              <Text numberOfLines={2} style={styles.tierBadgeLabel}>
                {medallion.label}
              </Text>
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.muted}>
          No achievements yet. They are awarded by the server as you run.
        </Text>
      )}
      {earnedCount > medallions.length && (
        <Text style={styles.settingsHint}>{`${earnedCount - medallions.length} more earned.`}</Text>
      )}
    </>
  );
}
