import { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import type { SemanticTokens } from '@runsphere/ui';
import { radius } from '@runsphere/ui';
import { useAppTheme } from '../theme/theme';

export const createAppStyles = (t: SemanticTokens) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.background.canvas },
    content: { padding: 18, paddingBottom: 118 },
    onboardingContent: { padding: 18, paddingBottom: 44 },
    flexCopy: { flex: 1 },
    // Off-screen live region: a screen reader speaks it, sighted users
    // read the same information from the cards themselves.
    visuallyHidden: { color: t.text.secondary, fontSize: 1, height: 1, opacity: 0, width: 1 },
    loading: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: 30 },
    eyebrow: { color: t.status.success, fontSize: 11, fontWeight: '900', letterSpacing: 1.4 },
    teal: { color: t.status.success },
    lead: { color: t.text.secondary, fontSize: 15, lineHeight: 23, marginBottom: 18 },
    onboardingTitle: {
      color: t.text.primary,
      fontSize: 34,
      fontWeight: '900',
      letterSpacing: -1.3,
      lineHeight: 38,
      marginBottom: 14
    },
    errorText: {
      color: t.status.error,
      fontSize: 14,
      fontWeight: '700',
      lineHeight: 20,
      marginTop: 16
    },

    /* ---------------------------------------------------------------- *
     * Generic surfaces
     * ---------------------------------------------------------------- */

    /** The default container. Every panel in the app is one of these. */
    card: {
      backgroundColor: t.background.surface,
      borderColor: t.border.subtle,
      borderRadius: radius.card,
      borderWidth: 1,
      marginBottom: 12,
      padding: 16
    },
    cardRow: { alignItems: 'center', flexDirection: 'row', gap: 12 },
    cardHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 12
    },
    cardTitle: { color: t.text.primary, fontSize: 16, fontWeight: '900' },
    divider: { backgroundColor: t.border.subtle, height: 1, marginVertical: 12 },
    /**
     * A tinted square holding one glyph. The tint is passed per use so a card
     * can carry its own meaning (streak amber, zone violet, rival coral)
     * without the sheet enumerating every combination.
     */
    iconChip: {
      alignItems: 'center',
      borderRadius: radius.chip,
      height: 40,
      justifyContent: 'center',
      width: 40
    },
    iconChipGlyph: { fontSize: 19 },

    /* ---------------------------------------------------------------- *
     * Screen headers
     * ---------------------------------------------------------------- */

    screenTitle: {
      color: t.text.primary,
      fontSize: 26,
      fontWeight: '900',
      letterSpacing: -0.8
    },
    header: {
      alignItems: 'center',
      flexDirection: 'row',
      height: 64,
      justifyContent: 'space-between'
    },
    greeting: { color: t.text.secondary, fontSize: 13, fontWeight: '700' },
    greetingName: {
      color: t.text.primary,
      fontSize: 24,
      fontWeight: '900',
      letterSpacing: -0.7,
      marginTop: 2
    },
    homeTitle: {
      color: t.text.primary,
      fontSize: 28,
      fontWeight: '900',
      letterSpacing: -1,
      lineHeight: 32,
      marginTop: 5
    },
    avatar: {
      alignItems: 'center',
      backgroundColor: t.background.surfaceRaised,
      borderColor: t.border.subtle,
      borderRadius: 20,
      borderWidth: 1,
      height: 40,
      justifyContent: 'center',
      overflow: 'hidden',
      width: 40
    },
    avatarText: { color: t.text.primary, fontSize: 14, fontWeight: '900' },
    /** Trailing controls in a dashboard header: notifications, then avatar. */
    headerActions: { alignItems: 'center', flexDirection: 'row', gap: 10 },
    headerButton: {
      alignItems: 'center',
      backgroundColor: t.background.surface,
      borderColor: t.border.subtle,
      borderRadius: 20,
      borderWidth: 1,
      height: 40,
      justifyContent: 'center',
      width: 40
    },
    headerButtonGlyph: { color: t.text.primary, fontSize: 18 },
    /**
     * Unread marker. A dot rather than a number: the badge is decoration over
     * a button whose accessible name already carries the count.
     */
    headerBadge: {
      backgroundColor: t.action.primary,
      borderColor: t.background.canvas,
      borderRadius: 5,
      borderWidth: 2,
      height: 10,
      position: 'absolute',
      right: 8,
      top: 8,
      width: 10
    },
    /** Tile-scale version of `iconChip`, sized for the 2x2 summary grid. */
    iconChipSmall: {
      alignItems: 'center',
      borderRadius: 10,
      height: 28,
      justifyContent: 'center',
      width: 28
    },
    iconChipSmallGlyph: { fontSize: 14 },
    chevron: { color: t.text.secondary, fontSize: 26, fontWeight: '700' },
    challengeProgress: { gap: 6, marginTop: 14 },

    /* ---------------------------------------------------------------- *
     * Streak + week strip (Home)
     * ---------------------------------------------------------------- */

    streakRow: { alignItems: 'center', flexDirection: 'row', gap: 12 },
    streakNumber: {
      color: t.text.primary,
      fontSize: 34,
      fontWeight: '900',
      letterSpacing: -1.4,
      lineHeight: 38
    },
    streakLabel: { color: t.text.secondary, fontSize: 12, fontWeight: '700', marginTop: -2 },
    weekRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 16 },
    weekDay: { alignItems: 'center', flex: 1, gap: 6 },
    weekDot: {
      backgroundColor: t.background.surfaceInset,
      borderColor: t.border.subtle,
      borderRadius: 6,
      borderWidth: 1,
      height: 11,
      width: 11
    },
    weekDotFilled: { backgroundColor: t.action.primary, borderColor: t.action.primary },
    weekLabel: { color: t.text.secondary, fontSize: 10, fontWeight: '800' },

    /* ---------------------------------------------------------------- *
     * Stat tiles (Home 2x2 grid, Profile row)
     * ---------------------------------------------------------------- */

    statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    statTile: {
      backgroundColor: t.background.surface,
      borderColor: t.border.subtle,
      borderRadius: radius.control,
      borderWidth: 1,
      flexGrow: 1,
      flexBasis: '46%',
      padding: 13
    },
    statTileHead: { alignItems: 'center', flexDirection: 'row', gap: 9 },
    statTileLabel: {
      color: t.text.secondary,
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 0.4
    },
    statTileValue: {
      color: t.text.primary,
      fontSize: 21,
      fontWeight: '900',
      letterSpacing: -0.6,
      marginTop: 8
    },
    statTileSuffix: { color: t.text.secondary, fontSize: 12, fontWeight: '800' },

    /* ---------------------------------------------------------------- *
     * Progress
     * ---------------------------------------------------------------- */

    progressTrack: {
      backgroundColor: t.background.surfaceInset,
      borderRadius: 999,
      height: 7,
      overflow: 'hidden'
    },
    progressFill: { backgroundColor: t.action.primary, borderRadius: 999, height: 7 },
    progressMeta: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginTop: 7
    },
    progressMetaText: { color: t.text.secondary, fontSize: 11, fontWeight: '800' },

    /* ---------------------------------------------------------------- *
     * Chips, pills, segmented controls
     * ---------------------------------------------------------------- */

    pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    pill: {
      backgroundColor: t.background.surfaceRaised,
      borderRadius: 999,
      minHeight: 34,
      justifyContent: 'center',
      paddingHorizontal: 14
    },
    pillActive: { backgroundColor: t.action.primary },
    pillText: { color: t.text.secondary, fontSize: 12, fontWeight: '800' },
    pillTextActive: { color: t.text.onAccent },
    /** Two-or-three-way switch inside a recessed track (Challenges, Social). */
    segmented: {
      backgroundColor: t.background.surfaceInset,
      borderRadius: 999,
      flexDirection: 'row',
      gap: 4,
      marginBottom: 14,
      padding: 4
    },
    segment: {
      alignItems: 'center',
      borderRadius: 999,
      flex: 1,
      justifyContent: 'center',
      minHeight: 36
    },
    segmentActive: { backgroundColor: t.action.primary },
    segmentText: { color: t.text.secondary, fontSize: 13, fontWeight: '800' },
    segmentTextActive: { color: t.text.onAccent },
    filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
    filterChip: {
      backgroundColor: t.background.surfaceRaised,
      borderRadius: 999,
      color: t.text.secondary,
      fontSize: 12,
      fontWeight: '800',
      overflow: 'hidden',
      paddingHorizontal: 13,
      paddingVertical: 8
    },
    filterChipActive: { backgroundColor: t.action.primary, color: t.text.onAccent },
    badge: {
      backgroundColor: t.background.surfaceRaised,
      borderRadius: 999,
      color: t.action.primary,
      fontSize: 10,
      fontWeight: '900',
      overflow: 'hidden',
      paddingHorizontal: 9,
      paddingVertical: 5
    },
    optionalBadge: { backgroundColor: t.background.surfaceRaised, color: t.text.secondary },
    mvpLabel: {
      alignSelf: 'flex-start',
      backgroundColor: t.background.surfaceRaised,
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
      backgroundColor: t.background.surfaceRaised,
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

    /* ---------------------------------------------------------------- *
     * Buttons
     * ---------------------------------------------------------------- */

    primaryButton: {
      alignItems: 'center',
      backgroundColor: t.action.primary,
      borderRadius: 999,
      flexDirection: 'row',
      justifyContent: 'center',
      marginTop: 12,
      minHeight: 54,
      paddingHorizontal: 20
    },
    primaryText: { color: t.text.onAccent, fontSize: 16, fontWeight: '900' },
    primaryArrow: { color: t.text.onAccent, fontSize: 20, position: 'absolute', right: 19 },
    buttonPressed: { opacity: 0.8 },
    buttonDisabled: { backgroundColor: t.action.disabled },
    /**
     * The stop control. White on a deeper red so the label clears AA, and
     * given the height the design asks of the one action that ends a run.
     */
    dangerButton: {
      alignItems: 'center',
      backgroundColor: t.action.danger,
      borderRadius: 999,
      justifyContent: 'center',
      marginTop: 10,
      minHeight: 56,
      paddingHorizontal: 20
    },
    dangerText: { color: '#FFFFFF', fontSize: 16, fontWeight: '900', letterSpacing: 0.3 },
    secondaryButton: {
      alignItems: 'center',
      backgroundColor: t.background.surfaceRaised,
      borderColor: t.border.subtle,
      borderRadius: 999,
      borderWidth: 1,
      justifyContent: 'center',
      minHeight: 50,
      paddingHorizontal: 20
    },
    secondaryText: { color: t.text.primary, fontSize: 15, fontWeight: '800' },
    textButton: {
      color: t.action.primary,
      fontSize: 15,
      fontWeight: '800',
      marginTop: 20,
      textAlign: 'center'
    },
    iconButton: {
      alignItems: 'center',
      backgroundColor: t.background.surface,
      borderColor: t.border.subtle,
      borderRadius: 20,
      borderWidth: 1,
      color: t.text.primary,
      fontSize: 20,
      height: 40,
      overflow: 'hidden',
      textAlign: 'center',
      textAlignVertical: 'center',
      width: 40
    },

    /* ---------------------------------------------------------------- *
     * Quick actions (Home)
     * ---------------------------------------------------------------- */

    quickActions: { flexDirection: 'row', gap: 10 },
    quickAction: {
      alignItems: 'center',
      borderRadius: radius.control,
      flex: 1,
      gap: 8,
      justifyContent: 'center',
      minHeight: 84,
      paddingHorizontal: 8,
      paddingVertical: 14
    },
    quickActionText: { fontSize: 12, fontWeight: '900', textAlign: 'center' },
    quickActionGlyph: { fontSize: 22 },

    /* ---------------------------------------------------------------- *
     * Headers for focused sub-screens
     * ---------------------------------------------------------------- */

    stepHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      height: 58,
      justifyContent: 'space-between',
      marginBottom: 16
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
    backText: { color: t.text.primary, fontSize: 26, lineHeight: 28 },
    stepText: { color: t.text.secondary, fontSize: 11, fontWeight: '900', letterSpacing: 1.2 },

    /* ---------------------------------------------------------------- *
     * Forms
     * ---------------------------------------------------------------- */

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
      borderRadius: radius.control,
      borderWidth: 1,
      color: t.text.primary,
      fontSize: 16,
      minHeight: 52,
      paddingHorizontal: 15
    },
    /** Rounded search field with a leading glyph (Map). */
    searchField: {
      alignItems: 'center',
      backgroundColor: t.background.surface,
      borderColor: t.border.subtle,
      borderRadius: 999,
      borderWidth: 1,
      flexDirection: 'row',
      gap: 10,
      minHeight: 46,
      paddingHorizontal: 16
    },
    searchGlyph: { color: t.text.secondary, fontSize: 15 },
    searchInput: { color: t.text.primary, flex: 1, fontSize: 14, padding: 0 },
    checkRow: { alignItems: 'center', flexDirection: 'row', marginTop: 20, paddingVertical: 5 },
    checkbox: {
      alignItems: 'center',
      borderColor: t.text.secondary,
      borderRadius: 6,
      borderWidth: 2,
      height: 22,
      justifyContent: 'center',
      marginRight: 10,
      width: 22
    },
    checkboxChecked: { backgroundColor: t.action.primary, borderColor: t.action.primary },
    checkMark: { color: t.text.onAccent, fontWeight: '900' },
    checkCopy: { color: t.text.primary, flex: 1, fontSize: 15, lineHeight: 21 },
    choiceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
    choice: {
      backgroundColor: t.background.surface,
      borderColor: t.border.subtle,
      borderRadius: radius.control,
      borderWidth: 1,
      flexGrow: 1,
      minHeight: 82,
      minWidth: '30%',
      padding: 14
    },
    choiceSelected: {
      backgroundColor: t.background.surfaceRaised,
      borderColor: t.action.primary,
      borderWidth: 2
    },
    choiceTitle: { color: t.text.primary, fontSize: 17, fontWeight: '900', marginBottom: 5 },
    stepperRow: { alignItems: 'center', flexDirection: 'row', gap: 14, marginBottom: 4 },
    stepperValue: {
      color: t.text.primary,
      flex: 1,
      fontSize: 22,
      fontWeight: '900',
      textAlign: 'center'
    },

    /* ---------------------------------------------------------------- *
     * Onboarding hero
     * ---------------------------------------------------------------- */

    hero: {
      backgroundColor: t.background.surfaceRaised,
      height: 234,
      marginHorizontal: -18,
      marginTop: -18,
      marginBottom: 24,
      overflow: 'hidden'
    },
    orbitOne: {
      borderColor: t.action.primary + '55',
      borderRadius: 160,
      borderWidth: 1,
      height: 290,
      left: -55,
      position: 'absolute',
      top: -70,
      width: 290
    },
    orbitTwo: {
      borderColor: t.action.primary + '55',
      borderRadius: 110,
      borderWidth: 1,
      bottom: -55,
      height: 200,
      position: 'absolute',
      right: -45,
      width: 200
    },
    heroPin: { color: t.action.primary, fontSize: 44, left: '54%', position: 'absolute', top: 102 },

    /* ---------------------------------------------------------------- *
     * Splash (first launch)
     * ---------------------------------------------------------------- */

    /**
     * Taller than the step hero and carrying the wordmark, so first launch is
     * one image with a name on it rather than art above a stack of copy.
     */
    splashHero: {
      backgroundColor: t.background.surfaceRaised,
      borderRadius: radius.card,
      height: 430,
      justifyContent: 'flex-end',
      marginBottom: 28,
      overflow: 'hidden'
    },
    splashMark: { gap: 10, padding: 24 },
    wordmark: {
      color: t.text.primary,
      fontSize: 40,
      fontWeight: '900',
      letterSpacing: -1.6
    },
    splashTagline: { color: t.text.secondary, fontSize: 17, fontWeight: '700', lineHeight: 24 },
    splashFooter: {
      color: t.text.secondary,
      fontSize: 12,
      fontWeight: '800',
      letterSpacing: 1.1,
      marginTop: 18,
      textAlign: 'center'
    },

    /* ---------------------------------------------------------------- *
     * Rows and list items
     * ---------------------------------------------------------------- */

    permissionCard: {
      alignItems: 'center',
      backgroundColor: t.background.surface,
      borderColor: t.border.subtle,
      borderRadius: radius.control,
      borderWidth: 1,
      flexDirection: 'row',
      marginBottom: 10,
      minHeight: 78,
      padding: 14
    },
    permissionIcon: { color: t.status.success, fontSize: 25, marginRight: 12 },
    rowTitle: { color: t.text.primary, fontSize: 15, fontWeight: '800' },
    rowDetail: { color: t.text.secondary, fontSize: 12, lineHeight: 17, marginTop: 3 },
    privacyRow: {
      alignItems: 'center',
      backgroundColor: t.background.surface,
      borderColor: t.border.subtle,
      borderRadius: radius.control,
      borderWidth: 1,
      flexDirection: 'row',
      marginTop: 4,
      minHeight: 80,
      padding: 14
    },
    privateNote: { color: t.text.secondary, fontSize: 12, lineHeight: 18, marginTop: 10 },
    historyRow: {
      alignItems: 'center',
      backgroundColor: t.background.surface,
      borderColor: t.border.subtle,
      borderRadius: radius.control,
      borderWidth: 1,
      flexDirection: 'row',
      marginBottom: 8,
      padding: 14
    },
    history: { marginTop: 22 },
    contactRow: {
      alignItems: 'center',
      borderBottomColor: t.border.subtle,
      borderBottomWidth: 1,
      flexDirection: 'row',
      minHeight: 58,
      paddingHorizontal: 15
    },

    /* ---------------------------------------------------------------- *
     * Leaderboards
     * ---------------------------------------------------------------- */

    leaderRow: {
      alignItems: 'center',
      backgroundColor: t.background.surfaceInset,
      borderRadius: radius.chip,
      flexDirection: 'row',
      gap: 10,
      marginBottom: 8,
      paddingHorizontal: 12,
      paddingVertical: 10
    },
    leaderRowSelf: { backgroundColor: t.action.primary + '1F' },
    leaderRank: {
      alignItems: 'center',
      backgroundColor: t.background.surfaceRaised,
      borderRadius: 11,
      height: 22,
      justifyContent: 'center',
      width: 22
    },
    leaderRankText: { color: t.text.secondary, fontSize: 11, fontWeight: '900' },
    leaderName: { color: t.text.primary, flex: 1, fontSize: 14, fontWeight: '800' },
    leaderScore: { color: t.action.primary, fontSize: 14, fontWeight: '900' },

    /* ---------------------------------------------------------------- *
     * Notices
     * ---------------------------------------------------------------- */

    notice: {
      alignItems: 'flex-start',
      backgroundColor: t.background.surfaceRaised,
      borderRadius: radius.control,
      flexDirection: 'row',
      marginBottom: 12,
      padding: 14
    },
    warningNotice: { backgroundColor: t.background.surfaceRaised },
    noticeIcon: { color: t.status.success, fontSize: 16, fontWeight: '900', marginRight: 11 },
    noticeTitle: { color: t.text.primary, fontSize: 13, fontWeight: '900' },
    noticeCopy: { color: t.text.secondary, fontSize: 12, lineHeight: 17, marginTop: 3 },
    safetyFooter: {
      color: t.text.secondary,
      fontSize: 12,
      lineHeight: 17,
      marginBottom: 10,
      textAlign: 'center'
    },
    centeredState: { flex: 1, justifyContent: 'center', minHeight: 500, paddingHorizontal: 4 },
    comingSoon: { flex: 1, justifyContent: 'center', minHeight: 480, paddingHorizontal: 20 },
    comingSoonTitle: { color: t.text.primary, fontSize: 30, fontWeight: '900', marginTop: 8 },
    comingSoonCopy: { color: t.text.secondary, fontSize: 15, lineHeight: 23, marginTop: 14 },

    /* ---------------------------------------------------------------- *
     * Stats + sections
     * ---------------------------------------------------------------- */

    cardTopline: { flexDirection: 'row', justifyContent: 'space-between' },
    stat: { flex: 1 },
    statLabel: { color: t.text.secondary, fontSize: 10, fontWeight: '900', letterSpacing: 0.9 },
    statValueLine: { alignItems: 'baseline', flexDirection: 'row', marginTop: 5 },
    statValue: { color: t.text.primary, fontSize: 23, fontWeight: '900', letterSpacing: -0.6 },
    statSuffix: { color: t.text.secondary, fontSize: 12, fontWeight: '700', marginLeft: 3 },
    statDetail: { color: t.status.success, fontSize: 10, fontWeight: '700', marginTop: 5 },
    /** Evenly divided read-only numbers (Run Summary, Zone Details, Profile). */
    metricRow: {
      backgroundColor: t.background.surface,
      borderColor: t.border.subtle,
      borderRadius: radius.control,
      borderWidth: 1,
      flexDirection: 'row',
      marginBottom: 12,
      paddingVertical: 14
    },
    metricCell: { alignItems: 'center', flex: 1, paddingHorizontal: 6 },
    metricCellValue: {
      color: t.text.primary,
      fontSize: 19,
      fontWeight: '900',
      letterSpacing: -0.5
    },
    metricCellLabel: {
      color: t.text.secondary,
      fontSize: 10,
      fontWeight: '800',
      marginTop: 4,
      textAlign: 'center'
    },
    sectionHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 12,
      marginTop: 22
    },
    sectionTitle: { color: t.text.primary, fontSize: 18, fontWeight: '900', letterSpacing: -0.4 },
    link: { color: t.action.primary, fontSize: 13, fontWeight: '800' },
    muted: { color: t.text.secondary, fontSize: 13 },

    /* ---------------------------------------------------------------- *
     * Profile
     * ---------------------------------------------------------------- */

    profileHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 18
    },
    profileHead: { alignItems: 'center', marginBottom: 18 },
    bigAvatar: {
      alignItems: 'center',
      backgroundColor: t.background.surfaceRaised,
      borderColor: t.action.primary,
      borderRadius: 44,
      borderWidth: 2,
      height: 88,
      justifyContent: 'center',
      width: 88
    },
    bigAvatarText: { color: t.text.primary, fontSize: 26, fontWeight: '900' },
    profileName: {
      color: t.text.primary,
      fontSize: 23,
      fontWeight: '900',
      letterSpacing: -0.6,
      marginTop: 12
    },
    levelDetail: { color: t.text.secondary, fontSize: 13, fontWeight: '700', marginTop: 4 },
    profileStats: {
      backgroundColor: t.background.surface,
      borderColor: t.border.subtle,
      borderRadius: radius.control,
      borderWidth: 1,
      flexDirection: 'row',
      marginBottom: 16,
      paddingVertical: 14
    },
    profileStat: { alignItems: 'center', flex: 1 },
    profileStatValue: { color: t.text.primary, fontSize: 19, fontWeight: '900' },
    profileStatLabel: {
      color: t.text.secondary,
      fontSize: 9,
      fontWeight: '900',
      letterSpacing: 0.7,
      marginTop: 4,
      textAlign: 'center'
    },
    /** Achievement medallion: a tinted rounded square with a glyph. */
    tierBadge: {
      alignItems: 'center',
      borderRadius: 20,
      height: 64,
      justifyContent: 'center',
      width: 64
    },
    tierBadgeGlyph: { fontSize: 26 },
    /** The achievement strip: evenly divided cells, each a medallion and a name. */
    tierRow: { flexDirection: 'row', gap: 10 },
    tierCell: { alignItems: 'center', flex: 1, gap: 2 },
    tierBadgeLabel: {
      color: t.text.secondary,
      fontSize: 10,
      fontWeight: '800',
      marginTop: 7,
      textAlign: 'center'
    },

    /* ---------------------------------------------------------------- *
     * Settings
     * ---------------------------------------------------------------- */

    settingsGroup: {
      backgroundColor: t.background.surface,
      borderColor: t.border.subtle,
      borderRadius: radius.control,
      borderWidth: 1,
      marginBottom: 14,
      overflow: 'hidden'
    },
    settingsTitle: {
      color: t.text.primary,
      fontSize: 15,
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
    settingsHint: {
      color: t.text.secondary,
      fontSize: 12,
      lineHeight: 17,
      paddingHorizontal: 15,
      paddingTop: 7
    },
    settingStack: { padding: 15 },
    destructive: { color: t.status.error },

    /* ---------------------------------------------------------------- *
     * Activity: preparation, live, results
     * ---------------------------------------------------------------- */

    recordCard: {
      backgroundColor: t.background.surface,
      borderColor: t.border.subtle,
      borderRadius: radius.card,
      borderWidth: 1,
      marginTop: 12,
      padding: 18
    },
    recordTitle: {
      color: t.text.primary,
      fontSize: 25,
      fontWeight: '900',
      letterSpacing: -0.8,
      marginBottom: 10,
      marginTop: 6
    },
    miniMap: {
      alignItems: 'center',
      backgroundColor: t.route.water,
      borderRadius: radius.card,
      height: 150,
      justifyContent: 'center',
      marginBottom: 18,
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
    liveScreen: { flex: 1, marginHorizontal: -18, marginTop: -18, minHeight: 520 },
    /** The run's own title bar, floated over the map while the tab bar is hidden. */
    liveTitleBar: {
      alignItems: 'center',
      gap: 4,
      left: 0,
      position: 'absolute',
      right: 0,
      top: 12
    },
    liveTitle: {
      color: t.text.primary,
      fontSize: 17,
      fontWeight: '900',
      letterSpacing: -0.3
    },
    liveGpsRow: { alignItems: 'center', flexDirection: 'row', gap: 6 },
    liveGpsDot: { borderRadius: 4, height: 8, width: 8 },
    liveGpsText: { color: t.text.secondary, fontSize: 12, fontWeight: '800' },
    liveOverlay: {
      backgroundColor: t.background.surface,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      gap: 8,
      marginTop: -28,
      padding: 18,
      paddingBottom: 26
    },
    liveStatus: {
      backgroundColor: t.background.surfaceInset,
      borderRadius: radius.chip,
      padding: 12
    },
    liveDistance: {
      color: t.text.primary,
      fontSize: 46,
      fontWeight: '900',
      letterSpacing: -2,
      lineHeight: 54,
      marginTop: 24,
      textAlign: 'center'
    },
    provisional: {
      color: t.text.secondary,
      fontSize: 11,
      fontWeight: '800',
      letterSpacing: 0.5,
      marginTop: 8,
      textAlign: 'center'
    },
    liveStats: {
      backgroundColor: t.background.surfaceInset,
      borderRadius: radius.control,
      flexDirection: 'row',
      alignItems: 'flex-start',
      flexWrap: 'wrap',
      gap: 12,
      marginTop: 12,
      padding: 14
    },
    resultStats: {
      backgroundColor: t.background.surfaceInset,
      borderRadius: radius.control,
      flexDirection: 'row',
      marginBottom: 10,
      marginTop: 8,
      padding: 14
    },
    checkpoint: {
      alignItems: 'center',
      borderBottomColor: t.border.subtle,
      borderBottomWidth: 1,
      flexDirection: 'row',
      minHeight: 62,
      paddingHorizontal: 15
    },
    checkpointNumber: {
      alignItems: 'center',
      backgroundColor: t.action.primary,
      borderRadius: 14,
      color: t.text.onAccent,
      fontSize: 13,
      fontWeight: '900',
      height: 28,
      marginRight: 11,
      overflow: 'hidden',
      textAlign: 'center',
      textAlignVertical: 'center',
      width: 28
    },
    questArt: {
      backgroundColor: t.background.surfaceRaised,
      borderRadius: radius.control,
      height: 120,
      marginBottom: 14
    },
    openPill: {
      backgroundColor: t.action.primary,
      borderRadius: 999,
      color: t.text.onAccent,
      fontSize: 10,
      fontWeight: '900',
      overflow: 'hidden',
      paddingHorizontal: 10,
      paddingVertical: 6
    },

    /* ---------------------------------------------------------------- *
     * Route preview + ghost race
     * ---------------------------------------------------------------- */

    routePreviewMap: {
      borderRadius: radius.card,
      height: 250,
      marginBottom: 14,
      overflow: 'hidden'
    },
    routeCardRow: { flexDirection: 'row', gap: 10, paddingBottom: 4, paddingRight: 18 },
    routeCard: {
      backgroundColor: t.background.surface,
      borderColor: t.border.subtle,
      borderRadius: radius.control,
      borderWidth: 1,
      padding: 14,
      width: 216
    },
    routeCardSelected: {
      backgroundColor: t.background.surfaceRaised,
      borderColor: t.action.primary,
      borderWidth: 2
    },
    routeFactRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
    routeName: {
      color: t.text.primary,
      fontSize: 24,
      fontWeight: '900',
      letterSpacing: -0.7,
      marginTop: 2
    },
    routeMeta: { color: t.text.primary, fontSize: 14, fontWeight: '800', marginTop: 5 },
    /** Which of the offered loops is on screen. */
    carouselDots: {
      alignSelf: 'center',
      flexDirection: 'row',
      gap: 6,
      marginBottom: 6,
      marginTop: 14
    },
    carouselDot: {
      backgroundColor: t.background.surfaceRaised,
      borderRadius: 4,
      height: 7,
      width: 7
    },
    carouselDotActive: { backgroundColor: t.action.primary, width: 18 },
    /** One published property of a route, as a reason it was offered. */
    reasonRow: {
      alignItems: 'center',
      backgroundColor: t.background.surface,
      borderColor: t.border.subtle,
      borderRadius: radius.control,
      borderWidth: 1,
      flexDirection: 'row',
      gap: 12,
      marginBottom: 8,
      minHeight: 56,
      paddingHorizontal: 14
    },
    reasonText: { color: t.text.primary, flex: 1, fontSize: 14, fontWeight: '700' },
    ghostCard: {
      backgroundColor: t.background.surfaceRaised,
      borderRadius: radius.chip,
      borderWidth: 2,
      gap: 3,
      padding: 12
    },
    ghostHeadline: { fontSize: 15, fontWeight: '900' },
    ghostDetail: { color: t.text.secondary, fontSize: 12, lineHeight: 17 }
  });

export const useAppStyles = () => {
  const { tokens } = useAppTheme();
  return useMemo(() => createAppStyles(tokens), [tokens]);
};
