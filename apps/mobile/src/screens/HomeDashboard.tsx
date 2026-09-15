import { Pressable, Text, View } from 'react-native';
import type { SemanticTokens } from '@runsphere/ui';
import { useAppStyles } from '../components/styles';
import { useAppTheme } from '../theme/theme';
import type {
  ActiveDaysPresentation,
  DashboardTile,
  GreetingPresentation,
  QuickAction
} from './home-dashboard-model';
import { QUICK_ACTIONS } from './home-dashboard-model';

/**
 * The dashboard furniture at the top of Home: greeting, the active-days
 * meter, the summary grid, and the quick actions.
 *
 * Split out of `HomeScreen` because the screen is already the place where
 * three remote loads and their failure states live; these are pure renderers
 * over presentation objects, which is also what makes them cheap to look at in
 * a render test.
 */
const HUE: Record<DashboardTile['hue'], (tokens: SemanticTokens) => string> = {
  accent: (tokens) => tokens.action.primary,
  violet: (tokens) => tokens.accent.violet,
  amber: (tokens) => tokens.accent.amber,
  azure: (tokens) => tokens.accent.azure
};

export function HomeHeader({
  greeting,
  unreadLabel,
  onOpenNotifications,
  onOpenProfile
}: {
  greeting: GreetingPresentation;
  /** Present only when the inbox has actually reported unread notices. */
  unreadLabel?: string;
  onOpenNotifications: () => void;
  onOpenProfile: () => void;
}) {
  const styles = useAppStyles();
  return (
    <View style={styles.header}>
      <View style={styles.flexCopy}>
        <Text style={styles.greeting}>{greeting.salutation}</Text>
        <Text accessibilityRole="header" style={styles.greetingName}>
          {greeting.name}
        </Text>
      </View>
      <View style={styles.headerActions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={unreadLabel ?? 'Notifications'}
          onPress={onOpenNotifications}
          style={({ pressed }) => [styles.headerButton, pressed && styles.buttonPressed]}
        >
          <Text style={styles.headerButtonGlyph}>◔</Text>
          {/* A dot, not a count: the badge appears only once the inbox has
              said there is something unread. */}
          {unreadLabel && <View style={styles.headerBadge} />}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open your profile"
          onPress={onOpenProfile}
          style={({ pressed }) => [styles.avatar, pressed && styles.buttonPressed]}
        >
          <Text style={styles.avatarText}>{greeting.initials}</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function ActiveDaysCard({ card }: { card: ActiveDaysPresentation }) {
  const styles = useAppStyles();
  const { tokens } = useAppTheme();
  return (
    <View style={styles.card}>
      <View style={styles.streakRow}>
        <View style={[styles.iconChip, { backgroundColor: tokens.accent.amber + '26' }]}>
          <Text style={[styles.iconChipGlyph, { color: tokens.accent.amber }]}>✹</Text>
        </View>
        <View style={styles.flexCopy}>
          <Text style={styles.streakNumber}>{card.value}</Text>
          <Text style={styles.streakLabel}>{card.caption}</Text>
        </View>
      </View>
      {/* Read as one count. The pips carry no weekday, because the server
          reports how many days were active and never which. */}
      <View
        accessible
        accessibilityLabel={card.accessibilityLabel}
        importantForAccessibility="yes"
        style={styles.weekRow}
      >
        {card.pips.map((pip) => (
          <View
            key={pip.index}
            importantForAccessibility="no-hide-descendants"
            style={[styles.weekDot, pip.active && styles.weekDotFilled]}
          />
        ))}
      </View>
    </View>
  );
}

export function DashboardGrid({ tiles }: { tiles: readonly DashboardTile[] }) {
  const styles = useAppStyles();
  const { tokens } = useAppTheme();
  if (!tiles.length) return null;
  return (
    <View style={styles.statGrid}>
      {tiles.map((tile) => {
        const hue = HUE[tile.hue](tokens);
        return (
          <View key={tile.key} style={styles.statTile}>
            <View style={styles.statTileHead}>
              <View style={[styles.iconChipSmall, { backgroundColor: hue + '26' }]}>
                <Text style={[styles.iconChipSmallGlyph, { color: hue }]}>{tile.glyph}</Text>
              </View>
              <Text style={styles.statTileLabel}>{tile.label}</Text>
            </View>
            <Text style={styles.statTileValue}>
              {tile.value}
              {tile.suffix ? <Text style={styles.statTileSuffix}> {tile.suffix}</Text> : null}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/**
 * The challenge the reader can act on today.
 *
 * Takes an already-resolved label and progress pair so the card cannot invent
 * a "0 / 2" for a challenge whose window has not been scored yet — the same
 * rule `play-model` keeps for in-progress challenges.
 */
export function TodaysChallengeCard({
  title,
  detail,
  progress,
  progressLabel,
  onPress
}: {
  title: string;
  detail: string;
  /** Percentage across the window, or undefined when nothing is scored yet. */
  progress: number | undefined;
  progressLabel: string | undefined;
  onPress: () => void;
}) {
  const styles = useAppStyles();
  const { tokens } = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${detail}`}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.buttonPressed]}
    >
      <View style={styles.cardRow}>
        <View style={[styles.iconChip, { backgroundColor: tokens.accent.gold + '26' }]}>
          <Text style={[styles.iconChipGlyph, { color: tokens.accent.gold }]}>♛</Text>
        </View>
        <View style={styles.flexCopy}>
          <Text style={styles.cardTitle}>{title}</Text>
          <Text style={styles.rowDetail}>{detail}</Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </View>
      {progress !== undefined && progressLabel && (
        <View style={styles.challengeProgress}>
          <View
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: 100, now: progress, text: progressLabel }}
            style={styles.progressTrack}
          >
            <View style={[styles.progressFill, { width: `${progress}%` }]} />
          </View>
          <Text style={styles.progressMetaText}>{progressLabel}</Text>
        </View>
      )}
    </Pressable>
  );
}

export function QuickActions({ onAction }: { onAction: (action: QuickAction['key']) => void }) {
  const styles = useAppStyles();
  const { tokens } = useAppTheme();
  // Fixed hues so the three actions stay individually recognisable at a
  // glance, which is the whole point of a quick-action row.
  const tint: Record<QuickAction['key'], string> = {
    run: tokens.action.primary,
    map: tokens.accent.violet,
    social: tokens.accent.amber
  };
  return (
    <>
      <View style={styles.sectionHeader}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          Quick actions
        </Text>
      </View>
      <View style={styles.quickActions}>
        {QUICK_ACTIONS.map((action) => (
          <Pressable
            key={action.key}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            onPress={() => onAction(action.key)}
            style={({ pressed }) => [
              styles.quickAction,
              { backgroundColor: tint[action.key] },
              pressed && styles.buttonPressed
            ]}
          >
            <Text style={[styles.quickActionGlyph, { color: tokens.text.onAccent }]}>
              {action.glyph}
            </Text>
            <Text style={[styles.quickActionText, { color: tokens.text.onAccent }]}>
              {action.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </>
  );
}
