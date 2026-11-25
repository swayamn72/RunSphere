import { appPalette } from '@runsphere/ui';
import { Pressable, View } from 'react-native';
import { Text } from '../components/Text';
import { SettingsButton } from '../components/SettingsButton';
import { useAppStyles } from '../components/styles';
import { useAppTheme } from '../theme/theme';
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

export function ProfileStats({ cells }: { cells: readonly ProfileStatCell[] }) {
  const styles = useAppStyles();
  if (!cells.length) return null;
  return (
    <View>
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        Career &amp; Turf Stats
      </Text>
      <View style={styles.statGrid}>
        {cells.map((cell) => (
          <View key={cell.key} style={styles.statTile}>
            <Text style={styles.statTileValue}>{cell.value}</Text>
            <Text style={[styles.metricCellLabel, { color: appPalette.mutedInk }]}>
              {cell.label}
            </Text>
          </View>
        ))}
      </View>
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
        <Text style={styles.muted}>No achievements yet. They arrive as you run.</Text>
      )}
      {earnedCount > medallions.length && (
        <Text style={styles.settingsHint}>{`${earnedCount - medallions.length} more earned.`}</Text>
      )}
    </>
  );
}
