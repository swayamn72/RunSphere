import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { TerritoryClaim, TerritoryClaimHistoryResponse } from '@runsphere/contracts';
import { CrewMascot } from '../components/CrewMascot';
import { useAppTheme } from '../theme/theme';
import {
  crewForAvatar,
  formatArea,
  formatLoopTime,
  historyLine,
  ownerColour,
  statusLabel
} from './territory-claim-model';

/**
 * One territory, in full (Phase 5, milestone 5.7; spec section 30).
 *
 * The bottom sheet on the map answers "should I bother with this?" in a glance.
 * This answers "what is this place?" — every owner it has passed through, every
 * challenge it has seen, and the time somebody would have to beat today.
 *
 * **Every number here is one the server actually holds.** "Battles" and
 * "defences" were unavailable until failed challenges were recorded, because a
 * defence is an attempt that came up short and nothing stored those. Rather
 * than approximate them from takeovers, the record was added.
 */
export interface TerritoryDetailScreenProps {
  readonly claim: TerritoryClaim;
  readonly history: TerritoryClaimHistoryResponse | undefined;
  readonly onBack: () => void;
}

export function TerritoryDetailScreen({ claim, history, onBack }: TerritoryDetailScreenProps) {
  const { tokens } = useAppTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const colour = ownerColour(claim.owner.id, claim.owner.isSelf);

  // The record is the best time anybody has held it with, which is not always
  // the current holder's: somebody faster may have held it and lost it since.
  const record = history?.recordSeconds ?? claim.durationSeconds;
  const beatsRecord = record < claim.durationSeconds;

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back to the map" onPress={onBack}>
        <Text style={styles.back}>← Map</Text>
      </Pressable>

      <View style={styles.owner}>
        <View style={[styles.avatar, { borderColor: colour }]}>
          <CrewMascot
            character={crewForAvatar(claim.owner.avatarKey)}
            size={44}
            accessibility={{ mode: 'decorative' }}
          />
        </View>
        <View style={styles.ownerText}>
          <Text accessibilityRole="header" style={styles.title}>
            {claim.owner.isSelf ? 'Your ground' : `${claim.owner.displayName}’s ground`}
          </Text>
          <Text style={styles.helper}>
            {claim.club ? `${statusLabel(claim)} · ${claim.club.name}` : statusLabel(claim)}
          </Text>
        </View>
      </View>

      <View style={styles.stats}>
        <Stat styles={styles} label="AREA" value={formatArea(claim.areaSqm)} />
        <Stat styles={styles} label="RECORD" value={formatLoopTime(record)} />
        <Stat
          styles={styles}
          label="LOOP"
          value={
            claim.distanceMetres && claim.distanceMetres > 0
              ? `${(claim.distanceMetres / 1000).toFixed(1)} km`
              : '—'
          }
        />
      </View>
      <View style={styles.stats}>
        <Stat styles={styles} label="BATTLES" value={String(history?.battleCount ?? 0)} />
        <Stat styles={styles} label="DEFENCES" value={String(history?.defendedCount ?? 0)} />
        <Stat styles={styles} label="OWNERS" value={String(history?.captureCount ?? 1)} />
      </View>

      {beatsRecord ? (
        // The record and the current holder are different facts, and a page
        // that showed only one of them would be quietly wrong.
        <Text style={styles.helper}>
          {`The record here is ${formatLoopTime(record)}, set by an earlier holder. The current holder took it in ${formatLoopTime(claim.durationSeconds)}.`}
        </Text>
      ) : null}

      <Text style={styles.callout}>
        {claim.owner.isSelf
          ? `You hold this with ${formatLoopTime(claim.durationSeconds)}. Anybody who runs this loop faster takes it.`
          : `Run this loop in under ${formatLoopTime(claim.durationSeconds)} and it is yours.`}
      </Text>

      <Text accessibilityRole="header" style={styles.section}>
        Owner history
      </Text>
      {!history ? (
        <Text style={styles.helper}>Loading the history of this ground.</Text>
      ) : history.entries.length === 0 ? (
        <Text style={styles.helper}>Nobody has held this ground yet.</Text>
      ) : (
        history.entries.map((entry, index) => (
          <View key={entry.claimId} style={styles.timelineRow}>
            {/*
              A rail rather than a bullet list: the point of this page is that a
              piece of ground has a story, and a story has an order.
            */}
            <View style={styles.rail}>
              <View
                style={[
                  styles.dot,
                  {
                    backgroundColor: entry.owner
                      ? ownerColour(entry.owner.id, entry.owner.isSelf)
                      : tokens.border.subtle
                  }
                ]}
              />
              {index < history.entries.length - 1 ? <View style={styles.line} /> : null}
            </View>
            <Text style={styles.timelineText}>{historyLine(entry)}</Text>
          </View>
        ))
      )}

      {history && history.defendedCount > 0 ? (
        <Text style={styles.helper}>
          {history.defendedCount === 1
            ? 'One challenge has come up short here.'
            : `${history.defendedCount} challenges have come up short here.`}
        </Text>
      ) : null}
    </ScrollView>
  );
}

function Stat({
  styles,
  label,
  value
}: {
  styles: ReturnType<typeof createStyles>;
  label: string;
  value: string;
}) {
  return (
    <View accessible accessibilityLabel={`${label}: ${value}`} style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

const createStyles = (tokens: ReturnType<typeof useAppTheme>['tokens']) =>
  StyleSheet.create({
    root: { backgroundColor: tokens.background.canvas, flex: 1 },
    content: { gap: 12, padding: 16, paddingBottom: 96 },
    back: { color: tokens.text.secondary, fontSize: 15, fontWeight: '800' },
    owner: { alignItems: 'center', flexDirection: 'row', gap: 12 },
    avatar: {
      alignItems: 'center',
      backgroundColor: tokens.background.surface,
      borderRadius: 30,
      borderWidth: 3,
      height: 60,
      justifyContent: 'center',
      width: 60
    },
    ownerText: { flex: 1, gap: 2 },
    title: { color: tokens.text.primary, fontSize: 22, fontWeight: '900' },
    helper: { color: tokens.text.secondary, fontSize: 13, lineHeight: 18 },
    stats: { flexDirection: 'row', gap: 10 },
    stat: {
      backgroundColor: tokens.background.surface,
      borderColor: tokens.border.subtle,
      borderRadius: 14,
      borderWidth: 1,
      flex: 1,
      gap: 2,
      padding: 12
    },
    statLabel: { color: tokens.text.tertiary, fontSize: 11, fontWeight: '800' },
    statValue: { color: tokens.text.primary, fontSize: 18, fontWeight: '900' },
    callout: {
      backgroundColor: tokens.background.surfaceInset,
      borderRadius: 14,
      color: tokens.text.primary,
      fontSize: 14,
      lineHeight: 20,
      padding: 12
    },
    section: { color: tokens.text.primary, fontSize: 16, fontWeight: '800', marginTop: 4 },
    timelineRow: { flexDirection: 'row', gap: 10 },
    rail: { alignItems: 'center', width: 14 },
    dot: { borderRadius: 5, height: 10, marginTop: 5, width: 10 },
    line: { backgroundColor: tokens.border.subtle, flex: 1, marginTop: 2, width: 2 },
    timelineText: { color: tokens.text.primary, flex: 1, fontSize: 14, lineHeight: 20 }
  });
