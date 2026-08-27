import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors } from '@runsphere/ui';
import { homeModel } from './src/models';

type Tab = 'Home' | 'Explore' | 'Season' | 'Clubs' | 'You';

const tabs: readonly Tab[] = ['Home', 'Explore', 'Season', 'Clubs', 'You'];

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('Home');
  const [activityStarted, setActivityStarted] = useState(false);
  const { dailyPath, member, nearbyQuest } = homeModel;
  const isHome = activeTab === 'Home';

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {isHome ? (
          <>
            <View style={styles.header}>
              <View>
                <Text style={styles.eyebrow}>{homeModel.dateLabel}</Text>
                <Text style={styles.greeting}>Good morning, {member.name}</Text>
              </View>
              <Pressable accessibilityLabel="Open profile" style={styles.avatar}>
                <Text style={styles.avatarText}>{member.initials}</Text>
              </Pressable>
            </View>

            <View style={styles.dailyCard}>
              <View style={styles.cardTopline}>
                <View>
                  <Text style={styles.eyebrow}>DAILY PATH</Text>
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
                <Text style={styles.muted}>6h 14m left</Text>
              </View>
              <View style={styles.leafCluster}>
                <Text style={styles.leaf}>✦</Text>
                <Text style={styles.leafSecond}>✦</Text>
                <Text style={styles.question}>?</Text>
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
              <Pressable accessibilityLabel="See all quests">
                <Text style={styles.link}>See all</Text>
              </Pressable>
            </View>
            <View style={styles.questCard}>
              <View style={styles.terrain}>
                <View style={styles.terrainSun} />
                <Text style={styles.distanceBadge}>{nearbyQuest.distanceKm} km</Text>
              </View>
              <View style={styles.questCopy}>
                <Text style={styles.questTitle}>{nearbyQuest.title}</Text>
                <Text style={styles.muted}>
                  Easy · {nearbyQuest.durationMinutes} min · Any pace
                </Text>
                <Text style={styles.reward}>{nearbyQuest.rewardXp} XP · 2 cells</Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </View>

            <Pressable
              accessibilityLabel="Start activity"
              onPress={() => setActivityStarted(true)}
              style={({ pressed }) => [styles.startButton, pressed && styles.pressed]}
            >
              <Text style={styles.play}>▶</Text>
              <Text style={styles.startText}>{activityStarted ? 'ACTIVITY READY' : 'START'}</Text>
            </Pressable>
            {activityStarted && (
              <Text style={styles.confirmation}>
                GPS setup is next. Your route stays private by default.
              </Text>
            )}
          </>
        ) : (
          <View style={styles.comingSoon}>
            <Text style={styles.eyebrow}>{activeTab.toUpperCase()}</Text>
            <Text style={styles.comingSoonTitle}>{activeTab} is coming soon.</Text>
            <Text style={styles.comingSoonCopy}>
              This m0 shell is intentionally limited to the Home experience while we validate the
              Android-first launch.
            </Text>
          </View>
        )}
      </ScrollView>
      <View style={styles.nav}>
        {tabs.map((tab) => (
          <Pressable
            key={tab}
            onPress={() => setActiveTab(tab)}
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
    </SafeAreaView>
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

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.cream },
  content: { padding: 20, paddingBottom: 118 },
  comingSoon: { flex: 1, minHeight: 480, justifyContent: 'center', paddingHorizontal: 22 },
  comingSoonTitle: { marginTop: 8, color: colors.ink, fontSize: 32, fontWeight: '900' },
  comingSoonCopy: { marginTop: 14, color: colors.muted, fontSize: 16, lineHeight: 24 },
  header: {
    height: 76,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  eyebrow: { fontSize: 11, letterSpacing: 1.5, fontWeight: '800', color: colors.teal },
  greeting: { marginTop: 5, fontSize: 19, fontWeight: '800', color: colors.ink },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.moss
  },
  avatarText: { color: '#fff', fontWeight: '900' },
  dailyCard: {
    minHeight: 220,
    padding: 20,
    overflow: 'hidden',
    borderRadius: 22,
    backgroundColor: colors.moss
  },
  cardTopline: { flexDirection: 'row', justifyContent: 'space-between' },
  cardTitle: { marginTop: 5, color: '#fff', fontSize: 21, fontWeight: '900' },
  xp: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    color: colors.ink,
    backgroundColor: colors.lime,
    fontSize: 12,
    fontWeight: '900'
  },
  cardCopy: { maxWidth: '78%', marginTop: 16, color: '#ECF1E8', lineHeight: 21 },
  progressTrack: {
    height: 8,
    marginTop: 20,
    overflow: 'hidden',
    borderRadius: 10,
    backgroundColor: '#4D786A'
  },
  progressFill: { width: '66%', height: '100%', borderRadius: 10, backgroundColor: colors.lime },
  progressMeta: { marginTop: 9, flexDirection: 'row', justifyContent: 'space-between' },
  progressStrong: { color: '#fff', fontSize: 12, fontWeight: '800' },
  muted: { color: colors.muted, fontSize: 13 },
  leafCluster: { position: 'absolute', right: 18, bottom: 16, width: 88, height: 70 },
  leaf: { color: colors.lime, fontSize: 44 },
  leafSecond: { position: 'absolute', left: 38, top: 22, color: '#A3D3AD', fontSize: 23 },
  question: {
    position: 'absolute',
    left: 65,
    top: 3,
    color: colors.orange,
    fontWeight: '900',
    fontSize: 27
  },
  statsRow: {
    marginTop: 18,
    padding: 17,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 18,
    flexDirection: 'row',
    backgroundColor: colors.card
  },
  stat: { flex: 1 },
  divider: { width: 1, marginHorizontal: 14, backgroundColor: colors.line },
  statLabel: { color: colors.muted, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  statValueLine: { marginTop: 5, flexDirection: 'row', alignItems: 'baseline' },
  statValue: { color: colors.ink, fontSize: 24, fontWeight: '900' },
  statSuffix: { marginLeft: 3, color: colors.muted, fontSize: 12, fontWeight: '700' },
  statDetail: { marginTop: 5, color: colors.teal, fontSize: 10, fontWeight: '700' },
  sectionHeader: {
    marginTop: 26,
    marginBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  sectionTitle: { fontSize: 18, fontWeight: '900', color: colors.ink },
  link: { fontWeight: '800', color: colors.moss },
  questCard: {
    minHeight: 112,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 18,
    backgroundColor: colors.card
  },
  terrain: {
    width: 82,
    height: 88,
    padding: 8,
    overflow: 'hidden',
    justifyContent: 'flex-end',
    borderRadius: 13,
    backgroundColor: '#C9DAC1'
  },
  terrainSun: {
    position: 'absolute',
    top: 12,
    right: 11,
    width: 27,
    height: 27,
    borderRadius: 15,
    backgroundColor: colors.orange
  },
  distanceBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: '#FFFEF8',
    color: colors.ink,
    fontSize: 10,
    fontWeight: '900'
  },
  questCopy: { flex: 1, paddingHorizontal: 13, gap: 5 },
  questTitle: { color: colors.ink, fontWeight: '900', fontSize: 16 },
  reward: { marginTop: 2, color: colors.teal, fontSize: 12, fontWeight: '900' },
  chevron: { color: colors.moss, fontSize: 30 },
  startButton: {
    height: 62,
    marginTop: 26,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 10,
    backgroundColor: colors.orange,
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 0,
    elevation: 4
  },
  pressed: { transform: [{ translateY: 2 }], shadowOpacity: 0.1 },
  play: { color: '#fff', fontSize: 15 },
  startText: { color: '#fff', fontSize: 17, fontWeight: '900', letterSpacing: 1 },
  confirmation: { marginTop: 12, textAlign: 'center', color: colors.muted, fontSize: 12 },
  nav: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 78,
    paddingTop: 9,
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.card
  },
  navItem: { flex: 1, alignItems: 'center', gap: 3 },
  navIcon: { color: colors.muted, fontSize: 20 },
  navText: { color: colors.muted, fontSize: 10, fontWeight: '700' },
  navActive: { color: colors.moss, fontWeight: '900' }
});
