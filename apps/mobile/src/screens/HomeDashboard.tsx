import type { ComponentProps, ReactNode } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../components/Text';
import { NavigationIcon } from '../components/NavigationIcon';
import Svg, { Path } from 'react-native-svg';
import { appPalette, darkTokens as tokens } from '@runsphere/ui';
import questWaterfront from '../../assets/quest-waterfront.jpg';
import type {
  ActiveDaysPresentation,
  DashboardTile,
  GreetingPresentation
} from './home-dashboard-model';
import type { WeeklyGoalMetric } from './home-state';

type IconName = ComponentProps<typeof NavigationIcon>['name'];

export function HomeHeader({
  greeting,
  unreadLabel,
  onOpenNotifications,
  onOpenProfile
}: {
  greeting: GreetingPresentation;
  unreadLabel?: string;
  onOpenNotifications: () => void;
  onOpenProfile: () => void;
}) {
  return (
    <View style={styles.header}>
      <View style={styles.copy}>
        <View style={styles.wordmark}>
          <Svg width={25} height={24} viewBox="0 0 25 24" accessible={false}>
            <Path
              d="M1 14l4-4h6l4 4v5l-4 4H5l-4-4zm10-10 4-4h6l4 4v5l-4 4h-6l-4-4z"
              fill={appPalette.accent}
            />
          </Svg>
          <Text style={styles.brand}>TURFR</Text>
        </View>
        <Text accessibilityRole="header" style={styles.name}>
          Hi, {greeting.name}
        </Text>
      </View>
      <View style={styles.headerTools}>
        <View style={styles.headerActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={unreadLabel ?? 'Notifications'}
            onPress={onOpenNotifications}
            style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
          >
            <NavigationIcon name="bell" color={tokens.text.primary} />
            {unreadLabel && <View style={styles.badge} />}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open your profile"
            onPress={onOpenProfile}
            style={({ pressed }) => [styles.avatar, pressed && styles.pressed]}
          >
            <Svg
              width={48}
              height={48}
              viewBox="0 0 48 48"
              style={styles.avatarShape}
              accessible={false}
            >
              <Path
                d="M24 2 43 13v22L24 46 5 35V13Z"
                fill={appPalette.canvas}
                stroke={appPalette.paper}
                strokeWidth={1.5}
                strokeLinejoin="round"
              />
            </Svg>
            <Text style={styles.title}>{greeting.initials}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

export function HomeStartButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Start a run"
      onPress={onPress}
      style={({ pressed }) => [styles.start, pressed && styles.pressed]}
    >
      <NavigationIcon name="runner" color={appPalette.ink} size={30} />
      <Text style={styles.startLabel}>Start a run</Text>
    </Pressable>
  );
}

const turfCells = Array.from({ length: 30 }, (_, index) => {
  const column = index % 6;
  const x = 60 + column * 24;
  const y = Math.floor(index / 6) * 28 + (column % 2) * 14;
  return `M${x - 16} ${y}l8 -14h16l8 14-8 14h-16z`;
});

export function HomeTurfCard({
  points,
  onPress
}: {
  points: string | undefined;
  onPress: () => void;
}) {
  return (
    <View style={styles.turf}>
      {/* Decorative illustration, independent of the runner's actual claims. */}
      <View pointerEvents="none" style={styles.turfArt}>
        <Svg
          width="100%"
          height="100%"
          viewBox="0 0 174 140"
          preserveAspectRatio="xMidYMid slice"
          accessible={false}
        >
          <Path d="M0 18C48 27 89 54 78 83C70 105 43 116 35 140H0Z" fill={appPalette.panel} />
          <Path
            d="M0 18C48 27 89 54 78 83C70 105 43 116 35 140 M0 10C58 19 105 52 91 86C80 111 56 124 48 140 M30 0L26 25 M63 0L45 34 M97 0L63 45 M125 0L76 58 M136 35L81 74 M137 76L74 92 M100 122L63 105 M77 140L46 123"
            fill="none"
            stroke={appPalette.mapLine}
            strokeWidth={2}
          />
          {turfCells.map((cell, index) => (
            <Path
              key={cell}
              d={cell}
              fill="none"
              stroke={index === 15 || index === 20 ? appPalette.accent : appPalette.mapLine}
              strokeWidth={index === 15 || index === 20 ? 2 : 1}
            />
          ))}
        </Svg>
      </View>
      <Text accessibilityRole="header" style={styles.turfTitle}>
        Turf
      </Text>
      {points !== undefined && (
        <>
          <Text style={styles.detail}>Turf points</Text>
          <Text style={styles.turfPoints}>{points}</Text>
          <Text style={styles.detail}>this season</Text>
        </>
      )}
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => [styles.mapButton, pressed && styles.pressed]}
      >
        <Text style={styles.title}>View map</Text>
      </Pressable>
    </View>
  );
}

export function HomeSectionTitle({
  children,
  onPaper = false
}: {
  children: ReactNode;
  onPaper?: boolean;
}) {
  return (
    <Text accessibilityRole="header" style={[styles.sectionTitle, onPaper && styles.ink]}>
      {children}
    </Text>
  );
}

function CardIcon({ name }: { name: IconName }) {
  return (
    <View style={styles.cardIcon}>
      <NavigationIcon name={name} color={tokens.text.secondary} size={24} />
    </View>
  );
}

export function HomeLinkRow({
  icon,
  title,
  detail,
  questImage,
  accessibilityLabel,
  onPress
}: {
  icon: IconName;
  title: string;
  detail?: ReactNode;
  questImage?: boolean;
  accessibilityLabel?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        styles.row,
        questImage && styles.questCard,
        pressed && styles.pressed
      ]}
    >
      {questImage ? (
        <Image accessible={false} source={questWaterfront} style={styles.questImage} />
      ) : (
        <CardIcon name={icon} />
      )}
      <View style={styles.copy}>
        <Text style={[styles.title, questImage && styles.ink]}>{title}</Text>
        {detail && <Text style={styles.detail}>{detail}</Text>}
      </View>
      <NavigationIcon
        name="chevron"
        color={questImage ? appPalette.ink : tokens.text.primary}
        size={20}
      />
    </Pressable>
  );
}

export function ActiveDaysCard({ card }: { card: ActiveDaysPresentation }) {
  return (
    <View accessible accessibilityLabel={card.accessibilityLabel} style={styles.days}>
      {/* The API provides a count, so the pips have no weekday labels. */}
      <View style={styles.pips}>
        {card.pips.map((pip) => (
          <View
            key={pip.index}
            importantForAccessibility="no-hide-descendants"
            style={[styles.pip, pip.active && styles.filledPip]}
          />
        ))}
      </View>
      <Text style={styles.daysLabel}>
        {card.value} {card.caption}
      </Text>
    </View>
  );
}

const statIcons = {
  distance: 'pin',
  'active-minutes': 'timer'
} as const satisfies Record<DashboardTile['key'], IconName>;

export function DashboardGrid({ tiles }: { tiles: readonly DashboardTile[] }) {
  if (!tiles.length) return null;
  return (
    <View style={styles.grid}>
      {tiles.map((tile) => (
        <View key={tile.key} style={[styles.card, styles.tile]}>
          <NavigationIcon name={statIcons[tile.key]} color={appPalette.ink} size={23} />
          <View style={styles.copy}>
            <Text style={styles.value}>
              {tile.value}
              {tile.suffix && <Text style={styles.unit}> {tile.suffix}</Text>}
            </Text>
            <Text style={styles.paperDetail}>{tile.label}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

export function WeeklyGoalCard({
  metric,
  onPress
}: {
  metric: WeeklyGoalMetric;
  onPress: () => void;
}) {
  const progressLabel = `${metric.actual} / ${metric.goal}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`This week's goal. ${metric.label}: ${progressLabel}, ${metric.progress}%.`}
      onPress={onPress}
      style={({ pressed }) => [styles.goal, pressed && styles.pressed]}
    >
      <View style={styles.row}>
        <NavigationIcon name="locate" color={appPalette.ink} size={24} />
        <View style={styles.copy}>
          <Text style={[styles.title, styles.ink]}>Weekly goal</Text>
          <Text style={styles.paperDetail}>{progressLabel}</Text>
        </View>
        <Text style={styles.percent}>{metric.progress}%</Text>
      </View>
      <View
        accessibilityRole="progressbar"
        accessibilityLabel="Weekly goal progress"
        accessibilityValue={{ min: 0, max: 100, now: metric.progress, text: progressLabel }}
        style={styles.track}
      >
        <View style={[styles.fill, { width: `${metric.progress}%` }]} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
    minHeight: 56
  },
  copy: { flex: 1, minWidth: 0 },
  headerTools: { alignItems: 'flex-end', gap: 8, flexShrink: 1 },
  headerActions: { flexDirection: 'row', gap: 10 },
  wordmark: { alignItems: 'center', flexDirection: 'row', gap: 8, marginBottom: 6 },
  brand: { color: tokens.text.primary, fontSize: 20, fontWeight: '700', letterSpacing: 1 },
  turf: {
    backgroundColor: appPalette.panel,
    borderColor: appPalette.border,
    borderRadius: 18,
    borderWidth: 1,
    marginBottom: 12,
    overflow: 'hidden',
    padding: 15
  },
  turfArt: {
    backgroundColor: appPalette.panel,
    bottom: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    width: '58%'
  },
  turfTitle: { color: tokens.text.primary, fontSize: 24, fontWeight: '700', marginBottom: 6 },
  turfPoints: { color: tokens.text.primary, fontSize: 40, fontWeight: '700' },
  mapButton: {
    alignSelf: 'flex-start',
    borderColor: tokens.text.secondary,
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: 'center',
    marginTop: 10,
    minHeight: 44,
    paddingHorizontal: 13
  },
  name: { color: tokens.text.primary, fontSize: 28, fontWeight: '700', letterSpacing: -0.8 },
  headerButton: {
    alignItems: 'center',
    backgroundColor: appPalette.panel,
    borderColor: appPalette.border,
    borderRadius: 24,
    borderWidth: 1,
    height: 48,
    justifyContent: 'center',
    width: 48
  },
  avatar: { width: 48, height: 48, justifyContent: 'center', alignItems: 'center' },
  avatarShape: { position: 'absolute' },
  badge: {
    backgroundColor: appPalette.accent,
    borderColor: appPalette.panel,
    borderRadius: 6,
    borderWidth: 1,
    height: 10,
    position: 'absolute',
    right: 9,
    top: 8,
    width: 10
  },
  start: {
    alignItems: 'center',
    backgroundColor: appPalette.accent,
    borderRadius: 16,
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'center',
    minHeight: 56,
    paddingHorizontal: 16,
    paddingVertical: 10
  },
  startLabel: { color: appPalette.ink, flexShrink: 1, fontSize: 24, fontWeight: '700' },
  sectionTitle: {
    color: tokens.text.primary,
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: -0.5,
    marginBottom: 8
  },
  card: {
    backgroundColor: appPalette.raised,
    borderColor: appPalette.border,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 10,
    paddingHorizontal: 13,
    paddingVertical: 10
  },
  row: { alignItems: 'center', flexDirection: 'row', gap: 12, minHeight: 42 },
  cardIcon: {
    alignItems: 'center',
    borderRightColor: tokens.border.subtle,
    borderRightWidth: 1,
    justifyContent: 'center',
    minHeight: 28,
    paddingRight: 11
  },
  title: { color: tokens.text.primary, fontSize: 15, fontWeight: '700' },
  detail: { color: tokens.text.secondary, fontSize: 14, fontWeight: '500' },
  ink: { color: appPalette.ink },
  paperDetail: { color: appPalette.mutedInk, fontSize: 14, fontWeight: '500' },
  questCard: { backgroundColor: appPalette.paper, borderColor: appPalette.paperLine },
  grid: { flexDirection: 'row', gap: 10 },
  tile: {
    alignItems: 'center',
    backgroundColor: appPalette.paper,
    borderColor: appPalette.paperLine,
    flex: 1,
    flexDirection: 'row',
    gap: 8,
    minHeight: 66
  },
  value: { color: appPalette.ink, fontSize: 24, fontWeight: '700', letterSpacing: -0.4 },
  unit: { color: appPalette.mutedInk, fontSize: 14, fontWeight: '700' },
  questImage: { width: '40%', aspectRatio: 1.9, borderRadius: 10 },
  days: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    paddingVertical: 8
  },
  daysLabel: { color: appPalette.ink, fontSize: 14, fontWeight: '700' },
  pips: { flex: 1, flexDirection: 'row', justifyContent: 'space-between', minWidth: 126 },
  goal: {
    borderTopColor: appPalette.paperLine,
    borderTopWidth: 1,
    marginTop: 8,
    paddingTop: 10
  },
  pip: {
    borderColor: appPalette.mutedInk,
    borderRadius: 6,
    borderWidth: 1,
    height: 13,
    width: 13
  },
  filledPip: { backgroundColor: appPalette.accent, borderColor: appPalette.accent },
  percent: { color: appPalette.ink, fontSize: 15, fontWeight: '700' },
  track: {
    backgroundColor: appPalette.paperLine,
    borderRadius: 999,
    height: 8,
    marginTop: 10,
    overflow: 'hidden'
  },
  fill: { backgroundColor: appPalette.accent, borderRadius: 999, height: '100%' },
  pressed: { opacity: 0.75 }
});
