import { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import type { SemanticTokens } from '@runsphere/ui';
import { useAppTheme } from '../theme/theme';

export const createAppStyles = (t: SemanticTokens) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.background.canvas },
    content: { padding: 20, paddingBottom: 118 },
    onboardingContent: { padding: 20, paddingBottom: 44 },
    flexCopy: { flex: 1 },
    loading: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: 30 },
    eyebrow: { color: t.status.success, fontSize: 11, fontWeight: '900', letterSpacing: 1.4 },
    teal: { color: t.status.success },
    lead: { color: t.text.secondary, fontSize: 16, lineHeight: 24, marginBottom: 18 },
    onboardingTitle: {
      color: t.text.primary,
      fontSize: 34,
      fontWeight: '900',
      letterSpacing: -1.3,
      lineHeight: 36,
      marginBottom: 14
    },
    errorText: {
      color: t.status.error,
      fontSize: 14,
      fontWeight: '700',
      lineHeight: 20,
      marginTop: 16
    },
    hero: {
      backgroundColor: t.action.primary,
      height: 234,
      marginHorizontal: -20,
      marginTop: -20,
      marginBottom: 25,
      overflow: 'hidden'
    },
    orbitOne: {
      borderColor: t.action.primary + '77',
      borderRadius: 160,
      borderWidth: 1,
      height: 290,
      left: -55,
      position: 'absolute',
      top: -70,
      width: 290
    },
    orbitTwo: {
      borderColor: t.action.primary + '77',
      borderRadius: 110,
      borderWidth: 1,
      bottom: -55,
      height: 200,
      position: 'absolute',
      right: -45,
      width: 200
    },
    heroPin: { color: t.action.primary, fontSize: 44, left: '54%', position: 'absolute', top: 102 },
    choiceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
    choice: {
      backgroundColor: t.background.surface,
      borderColor: t.border.subtle,
      borderRadius: 16,
      borderWidth: 1,
      flexGrow: 1,
      minHeight: 82,
      minWidth: '30%',
      padding: 14
    },
    choiceSelected: {
      backgroundColor: t.background.surfaceInset,
      borderColor: t.status.success,
      borderWidth: 2
    },
    choiceTitle: { color: t.text.primary, fontSize: 17, fontWeight: '900', marginBottom: 5 },
    primaryButton: {
      alignItems: 'center',
      backgroundColor: t.action.primary,
      borderRadius: 18,
      flexDirection: 'row',
      justifyContent: 'center',
      marginTop: 12,
      minHeight: 56,
      paddingHorizontal: 20
    },
    primaryText: { color: t.text.inverse, fontSize: 16, fontWeight: '900' },
    primaryArrow: { color: t.text.inverse, fontSize: 20, position: 'absolute', right: 19 },
    buttonPressed: { opacity: 0.8 },
    buttonDisabled: { backgroundColor: t.action.disabled },
    textButton: {
      color: t.action.primary,
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
      backgroundColor: t.background.surface,
      borderColor: t.border.subtle,
      borderRadius: 20,
      borderWidth: 1,
      height: 40,
      justifyContent: 'center',
      width: 40
    },
    backText: { color: t.text.primary, fontSize: 28, lineHeight: 30 },
    stepText: { color: t.text.secondary, fontSize: 11, fontWeight: '900', letterSpacing: 1.2 },
    fieldLabel: {
      color: t.text.secondary,
      fontSize: 11,
      fontWeight: '900',
      letterSpacing: 1.1,
      marginBottom: 7,
      marginTop: 10
    },
    input: {
      backgroundColor: t.background.surface,
      borderColor: t.border.subtle,
      borderRadius: 14,
      borderWidth: 1,
      color: t.text.primary,
      fontSize: 16,
      minHeight: 54,
      paddingHorizontal: 15
    },
    checkRow: { alignItems: 'center', flexDirection: 'row', marginTop: 20, paddingVertical: 5 },
    checkbox: {
      alignItems: 'center',
      borderColor: t.text.secondary,
      borderRadius: 5,
      borderWidth: 2,
      height: 22,
      justifyContent: 'center',
      marginRight: 10,
      width: 22
    },
    checkboxChecked: { backgroundColor: t.status.success, borderColor: t.status.success },
    checkMark: { color: t.text.inverse, fontWeight: '900' },
    checkCopy: { color: t.text.primary, flex: 1, fontSize: 15, lineHeight: 21 },
    miniMap: {
      alignItems: 'center',
      backgroundColor: t.route.water,
      borderRadius: 20,
      height: 130,
      justifyContent: 'center',
      marginBottom: 20,
      overflow: 'hidden'
    },
    mapRoute: { color: t.action.primary, fontSize: 112, transform: [{ rotate: '-20deg' }] },
    mapShield: {
      backgroundColor: t.action.primary,
      borderRadius: 20,
      color: t.action.primary,
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
      backgroundColor: t.background.surface,
      borderColor: t.border.subtle,
      borderRadius: 16,
      borderWidth: 1,
      flexDirection: 'row',
      marginBottom: 10,
      minHeight: 78,
      padding: 13
    },
    permissionIcon: { color: t.status.success, fontSize: 27, marginRight: 12 },
    rowTitle: { color: t.text.primary, fontSize: 15, fontWeight: '800' },
    rowDetail: { color: t.text.secondary, fontSize: 12, lineHeight: 17, marginTop: 3 },
    badge: {
      backgroundColor: t.background.surfaceInset,
      borderRadius: 12,
      color: t.action.primary,
      fontSize: 10,
      fontWeight: '900',
      overflow: 'hidden',
      paddingHorizontal: 8,
      paddingVertical: 5
    },
    optionalBadge: { backgroundColor: t.background.surfaceInset, color: t.text.secondary },
    privacyRow: {
      alignItems: 'center',
      backgroundColor: t.background.surface,
      borderColor: t.border.subtle,
      borderRadius: 16,
      borderWidth: 1,
      flexDirection: 'row',
      marginTop: 4,
      minHeight: 80,
      padding: 13
    },
    privateNote: { color: t.text.secondary, fontSize: 12, lineHeight: 18, marginTop: 10 },
    mascotGuide: {
      alignItems: 'center',
      backgroundColor: t.background.surfaceInset,
      borderColor: t.border.subtle,
      borderRadius: 16,
      borderWidth: 1,
      flexDirection: 'row',
      gap: 12,
      marginBottom: 12,
      padding: 12
    },
    header: {
      alignItems: 'center',
      flexDirection: 'row',
      height: 76,
      justifyContent: 'space-between'
    },
    greeting: { color: t.text.primary, fontSize: 19, fontWeight: '800', marginTop: 5 },
    homeTitle: {
      color: t.text.primary,
      fontSize: 31,
      fontWeight: '900',
      letterSpacing: -1.2,
      lineHeight: 34,
      marginTop: 5
    },
    mvpLabel: {
      alignSelf: 'flex-start',
      backgroundColor: t.background.surfaceInset,
      borderRadius: 999,
      color: t.action.primary,
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
      backgroundColor: t.background.surfaceInset,
      borderRadius: 999,
      color: t.status.error,
      fontSize: 10,
      fontWeight: '900',
      letterSpacing: 0.7,
      marginBottom: 12,
      overflow: 'hidden',
      paddingHorizontal: 9,
      paddingVertical: 5
    },
    activityBadge: {
      backgroundColor: t.background.surfaceInset,
      borderRadius: 12,
      color: t.action.primary,
      fontSize: 18,
      fontWeight: '900',
      overflow: 'hidden',
      paddingHorizontal: 10,
      paddingVertical: 6
    },
    cardAction: { color: t.text.inverse, fontSize: 12, fontWeight: '900' },
    verified: { color: t.status.success, fontSize: 12, fontWeight: '800', marginTop: 7 },
    filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
    filterChip: {
      backgroundColor: t.background.surfaceInset,
      borderRadius: 99,
      color: t.text.secondary,
      fontSize: 11,
      fontWeight: '800',
      overflow: 'hidden',
      paddingHorizontal: 11,
      paddingVertical: 8
    },
    filterChipActive: { backgroundColor: t.action.primary, color: t.text.inverse },
    notice: {
      alignItems: 'flex-start',
      backgroundColor: t.background.surfaceInset,
      borderRadius: 16,
      flexDirection: 'row',
      marginBottom: 12,
      padding: 13
    },
    warningNotice: { backgroundColor: t.background.surfaceInset },
    noticeIcon: { color: t.status.success, fontSize: 16, fontWeight: '900', marginRight: 11 },
    noticeTitle: { color: t.text.primary, fontSize: 13, fontWeight: '900' },
    noticeCopy: { color: t.text.secondary, fontSize: 12, lineHeight: 17, marginTop: 3 },
    questArt: {
      backgroundColor: t.status.success,
      borderRadius: 16,
      height: 120,
      marginBottom: 14
    },
    openPill: {
      backgroundColor: t.action.primary,
      borderRadius: 999,
      color: t.text.primary,
      fontSize: 10,
      fontWeight: '900',
      overflow: 'hidden',
      paddingHorizontal: 10,
      paddingVertical: 6
    },
    centeredState: { flex: 1, justifyContent: 'center', minHeight: 500, paddingHorizontal: 4 },
    safetyFooter: {
      color: t.text.secondary,
      fontSize: 12,
      lineHeight: 17,
      marginBottom: 10,
      textAlign: 'center'
    },

    avatar: {
      alignItems: 'center',
      backgroundColor: t.action.primary,
      borderRadius: 21,
      height: 42,
      justifyContent: 'center',
      width: 42
    },
    avatarText: { color: t.text.inverse, fontWeight: '900' },
    dailyCard: {
      backgroundColor: t.action.primary,
      borderRadius: 22,
      minHeight: 200,
      overflow: 'hidden',
      padding: 20
    },
    cardTopline: { flexDirection: 'row', justifyContent: 'space-between' },
    cardEyebrow: { color: t.action.primary, fontSize: 11, fontWeight: '900', letterSpacing: 1.3 },
    cardTitle: { color: t.text.inverse, fontSize: 21, fontWeight: '900', marginTop: 5 },
    cardCopy: { color: t.text.inverse, lineHeight: 21, marginTop: 16, maxWidth: '80%' },
    progressTrack: {
      backgroundColor: t.border.strong,
      borderRadius: 10,
      height: 8,
      marginTop: 20,
      overflow: 'hidden'
    },
    progressFill: {
      backgroundColor: t.action.primary,
      borderRadius: 10,
      height: '100%',
      width: '66%'
    },
    progressMeta: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 9 },
    progressStrong: { color: t.text.inverse, fontSize: 12, fontWeight: '800' },
    cardMuted: { color: t.text.inverse, fontSize: 12 },
    statsRow: {
      backgroundColor: t.background.surface,
      borderColor: t.border.subtle,
      borderRadius: 18,
      borderWidth: 1,
      flexDirection: 'row',
      marginTop: 18,
      padding: 17
    },
    stat: { flex: 1 },
    divider: { backgroundColor: t.border.subtle, marginHorizontal: 14, width: 1 },
    statLabel: { color: t.text.secondary, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
    statValueLine: { alignItems: 'baseline', flexDirection: 'row', marginTop: 5 },
    statValue: { color: t.text.primary, fontSize: 24, fontWeight: '900' },
    statSuffix: { color: t.text.secondary, fontSize: 12, fontWeight: '700', marginLeft: 3 },
    statDetail: { color: t.status.success, fontSize: 10, fontWeight: '700', marginTop: 5 },
    sectionHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 12,
      marginTop: 26
    },
    sectionTitle: { color: t.text.primary, fontSize: 18, fontWeight: '900' },
    link: { color: t.action.primary, fontWeight: '800' },
    questCard: {
      alignItems: 'center',
      backgroundColor: t.background.surface,
      borderColor: t.border.subtle,
      borderRadius: 18,
      borderWidth: 1,
      flexDirection: 'row',
      minHeight: 112,
      padding: 10
    },
    terrain: {
      alignItems: 'center',
      backgroundColor: t.background.surfaceInset,
      borderRadius: 13,
      height: 90,
      justifyContent: 'center',
      width: 88
    },
    distanceBadge: {
      backgroundColor: t.background.surface,
      borderRadius: 12,
      color: t.text.primary,
      fontSize: 12,
      fontWeight: '900',
      overflow: 'hidden',
      paddingHorizontal: 8,
      paddingVertical: 5
    },
    questCopy: { flex: 1, marginLeft: 13 },
    questTitle: { color: t.text.primary, fontSize: 16, fontWeight: '900', marginBottom: 4 },
    muted: { color: t.text.secondary, fontSize: 13 },
    reward: { color: t.status.success, fontSize: 12, fontWeight: '800', marginTop: 7 },
    confirmation: {
      color: t.status.success,
      fontWeight: '700',
      marginTop: 16,
      textAlign: 'center'
    },
    comingSoon: { flex: 1, justifyContent: 'center', minHeight: 480, paddingHorizontal: 22 },
    comingSoonTitle: { color: t.text.primary, fontSize: 32, fontWeight: '900', marginTop: 8 },
    comingSoonCopy: { color: t.text.secondary, fontSize: 16, lineHeight: 24, marginTop: 14 },
    profileHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 18
    },
    iconButton: {
      alignItems: 'center',
      backgroundColor: t.background.surface,
      borderColor: t.border.subtle,
      borderRadius: 20,
      borderWidth: 1,
      color: t.text.primary,
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
      backgroundColor: t.action.primary,
      borderRadius: 34,
      height: 68,
      justifyContent: 'center',
      marginRight: 14,
      width: 68
    },
    bigAvatarText: { color: t.text.inverse, fontSize: 20, fontWeight: '900' },
    profileName: { color: t.text.primary, fontSize: 25, fontWeight: '900' },
    profileStats: {
      backgroundColor: t.background.surface,
      borderColor: t.border.subtle,
      borderRadius: 17,
      borderWidth: 1,
      flexDirection: 'row',
      marginBottom: 22,
      paddingVertical: 14
    },
    profileStat: { alignItems: 'center', flex: 1 },
    profileStatValue: { color: t.text.primary, fontSize: 20, fontWeight: '900' },
    profileStatLabel: {
      color: t.text.secondary,
      fontSize: 9,
      fontWeight: '900',
      letterSpacing: 0.8,
      marginTop: 4
    },
    settingsGroup: {
      backgroundColor: t.background.surface,
      borderColor: t.border.subtle,
      borderRadius: 17,
      borderWidth: 1,
      marginBottom: 16,
      overflow: 'hidden'
    },
    settingsTitle: {
      color: t.text.primary,
      fontSize: 16,
      fontWeight: '900',
      paddingHorizontal: 15,
      paddingTop: 15
    },
    setting: {
      alignItems: 'center',
      borderBottomColor: t.border.subtle,
      borderBottomWidth: 1,
      flexDirection: 'row',
      justifyContent: 'space-between',
      minHeight: 54,
      paddingHorizontal: 15
    },
    settingDisabled: { opacity: 0.55 },
    settingValue: {
      color: t.text.secondary,
      fontSize: 13,
      fontWeight: '700',
      marginLeft: 12,
      textAlign: 'right'
    },
    destructive: { color: t.status.error },
    recordCard: {
      backgroundColor: t.background.surface,
      borderColor: t.border.subtle,
      borderRadius: 22,
      borderWidth: 1,
      marginTop: 12,
      padding: 20
    },
    recordTitle: {
      color: t.text.primary,
      fontSize: 27,
      fontWeight: '900',
      letterSpacing: -0.7,
      marginBottom: 10,
      marginTop: 7
    },
    liveCard: { backgroundColor: t.action.primary, borderRadius: 22, marginTop: 12, padding: 20 },
    liveTop: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
    gpsStrong: { color: t.action.primary, fontSize: 11, fontWeight: '900' },
    liveDistance: {
      color: t.text.inverse,
      fontSize: 48,
      fontWeight: '900',
      letterSpacing: -2,
      marginTop: 28,
      textAlign: 'center'
    },
    unit: { color: t.text.inverse, fontSize: 20, letterSpacing: 0 },
    provisional: {
      color: t.text.secondary,
      fontSize: 11,
      fontWeight: '800',
      letterSpacing: 0.5,
      marginTop: 8,
      textAlign: 'center'
    },
    liveStats: {
      backgroundColor: t.scrim.subtle,
      borderRadius: 16,
      flexDirection: 'row',
      marginTop: 24,
      padding: 14
    },
    gpsError: {
      alignSelf: 'center',
      backgroundColor: t.status.warning,
      borderRadius: 24,
      color: t.text.inverse,
      fontSize: 25,
      fontWeight: '900',
      height: 48,
      overflow: 'hidden',
      textAlign: 'center',
      textAlignVertical: 'center',
      width: 48
    },
    recovery: { color: t.text.primary, fontSize: 15, lineHeight: 27, marginBottom: 14 },
    resultStats: {
      backgroundColor: t.background.canvas,
      borderRadius: 16,
      flexDirection: 'row',
      marginBottom: 10,
      marginTop: 8,
      padding: 14
    },
    history: { marginTop: 24 },
    historyRow: {
      alignItems: 'center',
      backgroundColor: t.background.surface,
      borderColor: t.border.subtle,
      borderRadius: 14,
      borderWidth: 1,
      flexDirection: 'row',
      marginBottom: 8,
      padding: 14
    },
    settingsHint: {
      color: t.text.secondary,
      fontSize: 12,
      lineHeight: 17,
      paddingHorizontal: 15,
      paddingTop: 7
    },
    settingStack: { padding: 15 },
    checkpoint: {
      alignItems: 'center',
      borderBottomColor: t.border.subtle,
      borderBottomWidth: 1,
      flexDirection: 'row',
      minHeight: 64,
      paddingHorizontal: 15
    },
    checkpointNumber: {
      alignItems: 'center',
      backgroundColor: t.action.primary,
      borderRadius: 14,
      color: t.text.primary,
      fontSize: 13,
      fontWeight: '900',
      height: 28,
      marginRight: 11,
      overflow: 'hidden',
      textAlign: 'center',
      textAlignVertical: 'center',
      width: 28
    },
    contactRow: {
      alignItems: 'center',
      borderBottomColor: t.border.subtle,
      borderBottomWidth: 1,
      flexDirection: 'row',
      minHeight: 58,
      paddingHorizontal: 15
    }
  });

export const useAppStyles = () => {
  const { tokens } = useAppTheme();
  return useMemo(() => createAppStyles(tokens), [tokens]);
};
