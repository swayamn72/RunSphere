import { useEffect, useState } from 'react';
import { Alert, AppState, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import type { ProgressionSummary } from '@runsphere/contracts';
import { darkTokens, space } from '@runsphere/ui';
import type { MobileApiClient } from '../api-client';
import { dashboardPreviewEnabled, previewProgression } from '../screens/dashboard-preview';
import { progressionPresentation } from '../screens/home-progression-model';
import { XP_INFO_COPY } from '../screens/profile-overview-model';
import { gameWorld } from '../theme/game-world';

export function ScreenProgression({
  api,
  refreshKey,
  inHeader = false
}: {
  api: MobileApiClient;
  refreshKey: string;
  inHeader?: boolean;
}) {
  const [summary, setSummary] = useState<ProgressionSummary>();
  useEffect(() => {
    if (dashboardPreviewEnabled) return;
    let current = 0;
    const load = async () => {
      const request = ++current;
      try {
        const next = await api.getProgressionSummary();
        if (request === current) setSummary(next);
      } catch {
        if (request === current) setSummary(undefined);
      }
    };
    void load();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void load();
    });
    return () => {
      current += 1;
      subscription.remove();
    };
  }, [api, refreshKey]);
  const displayed = dashboardPreviewEnabled ? previewProgression : summary;
  if (!displayed) return null;
  return (
    <View style={inHeader ? undefined : styles.screenStatus}>
      <ProgressionBadge summary={displayed} />
    </View>
  );
}

export function ProgressionBadge({
  summary,
  turf = false
}: {
  summary: ProgressionSummary | undefined;
  turf?: boolean;
}) {
  if (!summary) return null;
  const { level, totalXpLabel } = progressionPresentation(summary, undefined);
  const label = level ? `${level.levelLabel} · ${totalXpLabel}` : totalXpLabel;
  const compactXp = totalXpLabel.replace(' XP', '\u00a0XP');
  const badgeLabel = summary.level ? `LVL ${summary.level.level} · ${compactXp}` : compactXp;
  const progress = level?.progress;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={progress === undefined ? label : `${label}, ${progress}% to next level`}
      accessibilityHint="Shows how XP works"
      onPress={() =>
        Alert.alert(label, level ? `${level.xpInLevelLabel}\n\n${XP_INFO_COPY}` : XP_INFO_COPY)
      }
      style={[styles.badge, turf && styles.turfBadge]}
    >
      <Text style={styles.label}>{badgeLabel}</Text>
      {progress !== undefined && (
        <View
          accessibilityRole="progressbar"
          accessibilityLabel="Progress to next level"
          accessibilityValue={{ min: 0, max: 100, now: progress }}
          style={styles.track}
        >
          <View style={[styles.fill, { width: `${progress}%` }]} />
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screenStatus: { paddingHorizontal: space.xl, paddingTop: 6 },
  badge: {
    alignSelf: 'flex-end',
    backgroundColor: darkTokens.background.surface,
    borderColor: darkTokens.border.subtle,
    borderRadius: 18,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: space.md,
    paddingVertical: 6
  },
  turfBadge: { backgroundColor: gameWorld.hud.glass, borderColor: gameWorld.hud.edgeSoft },
  label: { color: darkTokens.text.primary, fontSize: 12, fontWeight: '700' },
  track: {
    backgroundColor: darkTokens.background.surfaceRaised,
    borderRadius: 3,
    height: 3,
    marginTop: space.xs,
    overflow: 'hidden'
  },
  fill: { backgroundColor: darkTokens.action.primary, height: '100%' }
});
