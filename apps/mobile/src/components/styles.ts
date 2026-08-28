import { StyleSheet } from 'react-native';
import { colors } from '@runsphere/ui';

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.cream },
  content: { padding: 20, paddingBottom: 118 },
  onboardingContent: { padding: 20, paddingBottom: 44 },
  flexCopy: { flex: 1 },
  loading: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: 30 },
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
  errorText: { color: '#B83220', fontSize: 14, fontWeight: '700', lineHeight: 20, marginTop: 16 },
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
  choiceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  choice: {
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderRadius: 16,
    borderWidth: 1,
    flexGrow: 1,
    minHeight: 82,
    minWidth: '30%',
    padding: 14
  },
  choiceSelected: { backgroundColor: '#EEF9E7', borderColor: colors.teal, borderWidth: 2 },
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
  homeTitle: {
    color: colors.ink,
    fontSize: 31,
    fontWeight: '900',
    letterSpacing: -1.2,
    lineHeight: 34,
    marginTop: 5
  },
  mvpLabel: {
    alignSelf: 'flex-start',
    backgroundColor: '#DCEADF',
    borderRadius: 999,
    color: colors.moss,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.7,
    marginBottom: 12,
    overflow: 'hidden',
    paddingHorizontal: 9,
    paddingVertical: 5
  },
  futureLabel: {
    alignSelf: 'flex-start',
    backgroundColor: '#FFF0E9',
    borderRadius: 999,
    color: '#A33F25',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.7,
    marginBottom: 12,
    overflow: 'hidden',
    paddingHorizontal: 9,
    paddingVertical: 5
  },
  activityBadge: {
    backgroundColor: '#DCEADF',
    borderRadius: 12,
    color: colors.moss,
    fontSize: 18,
    fontWeight: '900',
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 6
  },
  cardAction: { color: '#fff', fontSize: 12, fontWeight: '900' },
  verified: { color: colors.teal, fontSize: 12, fontWeight: '800', marginTop: 7 },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  filterChip: {
    backgroundColor: '#E5E9E1',
    borderRadius: 99,
    color: colors.muted,
    fontSize: 11,
    fontWeight: '800',
    overflow: 'hidden',
    paddingHorizontal: 11,
    paddingVertical: 8
  },
  filterChipActive: { backgroundColor: colors.moss, color: '#fff' },
  notice: {
    alignItems: 'flex-start',
    backgroundColor: '#E6F0F2',
    borderRadius: 16,
    flexDirection: 'row',
    marginBottom: 12,
    padding: 13
  },
  warningNotice: { backgroundColor: '#FFF0E9' },
  noticeIcon: { color: colors.teal, fontSize: 16, fontWeight: '900', marginRight: 11 },
  noticeTitle: { color: colors.ink, fontSize: 13, fontWeight: '900' },
  noticeCopy: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 3 },
  questArt: { backgroundColor: colors.teal, borderRadius: 16, height: 120, marginBottom: 14 },
  openPill: {
    backgroundColor: colors.lime,
    borderRadius: 999,
    color: colors.ink,
    fontSize: 10,
    fontWeight: '900',
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 6
  },
  centeredState: { flex: 1, justifyContent: 'center', minHeight: 500, paddingHorizontal: 4 },
  safetyFooter: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 10,
    textAlign: 'center'
  },

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
  settingDisabled: { opacity: 0.55 },
  settingValue: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700',
    marginLeft: 12,
    textAlign: 'right'
  },
  destructive: { color: '#B83220' },
  recordCard: {
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderRadius: 22,
    borderWidth: 1,
    marginTop: 12,
    padding: 20
  },
  recordTitle: {
    color: colors.ink,
    fontSize: 27,
    fontWeight: '900',
    letterSpacing: -0.7,
    marginBottom: 10,
    marginTop: 7
  },
  liveCard: { backgroundColor: colors.moss, borderRadius: 22, marginTop: 12, padding: 20 },
  liveTop: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  gpsStrong: { color: colors.lime, fontSize: 11, fontWeight: '900' },
  liveDistance: {
    color: '#fff',
    fontSize: 48,
    fontWeight: '900',
    letterSpacing: -2,
    marginTop: 28,
    textAlign: 'center'
  },
  unit: { color: '#D5E4DB', fontSize: 20, letterSpacing: 0 },
  provisional: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginTop: 8,
    textAlign: 'center'
  },
  liveStats: {
    backgroundColor: '#FFFFFF18',
    borderRadius: 16,
    flexDirection: 'row',
    marginTop: 24,
    padding: 14
  },
  gpsError: {
    alignSelf: 'center',
    backgroundColor: colors.orange,
    borderRadius: 24,
    color: '#fff',
    fontSize: 25,
    fontWeight: '900',
    height: 48,
    overflow: 'hidden',
    textAlign: 'center',
    textAlignVertical: 'center',
    width: 48
  },
  recovery: { color: colors.ink, fontSize: 15, lineHeight: 27, marginBottom: 14 },
  resultStats: {
    backgroundColor: colors.cream,
    borderRadius: 16,
    flexDirection: 'row',
    marginBottom: 10,
    marginTop: 8,
    padding: 14
  },
  history: { marginTop: 24 },
  historyRow: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    marginBottom: 8,
    padding: 14
  }
});
