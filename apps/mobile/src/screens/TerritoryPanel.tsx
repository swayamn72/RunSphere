import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { TerritoryLadderResponse, TerritoryMapResponse } from '@runsphere/contracts';
import { useAppTheme } from '../theme/theme';
import { MapSurface } from '../maps/MapSurface';
import {
  TERRITORY_LADDER_EMPTY_MESSAGE,
  TERRITORY_MAP_UNAVAILABLE_MESSAGE,
  territoryHeldSummary,
  territoryLadderEmptyReason,
  territoryLadderRows,
  territoryMapPlan,
  type CellBoundarySource
} from './territory-model';

/**
 * The season map and the division ladder (Phase 4, milestones 4.4 and 4.5).
 *
 * Nothing here can currently draw a cell: `boundaries` is the H3 binding this
 * app does not have, so the map renders its stated reason instead of a blank
 * city. That is the point of the component — the empty states are the part that
 * exists, and they are what somebody will actually see until the Territory gate
 * opens.
 */
export interface TerritoryPanelProps {
  readonly ladder: TerritoryLadderResponse | undefined;
  readonly map: TerritoryMapResponse | undefined;
  /** Absent until an H3 library is a dependency of this app (ADR-0001). */
  readonly boundaries?: CellBoundarySource | undefined;
}

export function TerritoryPanel({ ladder, map, boundaries }: TerritoryPanelProps) {
  const { tokens } = useAppTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const plan = useMemo(
    () => (map ? territoryMapPlan(map, boundaries) : undefined),
    [map, boundaries]
  );
  const rows = useMemo(() => (ladder ? territoryLadderRows(ladder) : []), [ladder]);
  const emptyReason = ladder ? territoryLadderEmptyReason(ladder) : undefined;

  if (!ladder && !map) return null;

  return (
    <View style={styles.card}>
      {map && plan ? (
        <>
          <Text accessibilityRole="header" style={styles.title}>
            Areas this week
          </Text>
          {plan.layer ? (
            <View style={styles.map}>
              <MapSurface
                accessibilityLabel={`Areas held this week. ${territoryHeldSummary(plan)}`}
                localLayers={[{ id: 'territory-cells', kind: 'fill', data: plan.layer }]}
                showAttribution
              />
            </View>
          ) : (
            <Text style={styles.body}>
              {TERRITORY_MAP_UNAVAILABLE_MESSAGE[plan.unavailable ?? 'no-boundaries']}
            </Text>
          )}
          <Text style={styles.body}>{territoryHeldSummary(plan)}</Text>
          {/*
            Said next to the picture rather than behind a link: what a person
            infers from a map of held ground is exactly what this one does not
            record.
          */}
          <Text style={styles.helper}>{map.mapNote}</Text>
        </>
      ) : null}

      {ladder ? (
        <>
          <Text accessibilityRole="header" style={styles.title}>
            Standings
          </Text>
          {emptyReason ? (
            <Text style={styles.body}>{TERRITORY_LADDER_EMPTY_MESSAGE[emptyReason]}</Text>
          ) : (
            rows.map((row) => (
              <View
                accessible
                accessibilityLabel={row.accessibilityLabel}
                key={`${row.rankLabel}-${row.pointsLabel}`}
                style={[styles.row, row.isSelf && styles.rowSelf]}
              >
                <Text style={styles.rank}>{row.rankLabel}</Text>
                <Text style={styles.body}>{row.pointsLabel}</Text>
                <Text style={styles.helper}>{row.weeksLabel}</Text>
              </View>
            ))
          )}
          <Text style={styles.helper}>{ladder.ladderNote}</Text>
        </>
      ) : null}
    </View>
  );
}

const createStyles = (tokens: ReturnType<typeof useAppTheme>['tokens']) =>
  StyleSheet.create({
    card: {
      backgroundColor: tokens.background.surface,
      borderColor: tokens.border.subtle,
      borderRadius: 20,
      borderWidth: 1,
      gap: 8,
      marginTop: 12,
      padding: 16
    },
    title: { color: tokens.text.primary, fontSize: 16, fontWeight: '800' },
    body: { color: tokens.text.primary, fontSize: 14, lineHeight: 20 },
    helper: { color: tokens.text.secondary, fontSize: 13, lineHeight: 18 },
    map: { borderRadius: 16, height: 240, overflow: 'hidden' },
    row: {
      alignItems: 'center',
      borderTopColor: tokens.border.subtle,
      borderTopWidth: 1,
      flexDirection: 'row',
      gap: 12,
      paddingVertical: 8
    },
    rowSelf: { backgroundColor: tokens.background.surfaceInset },
    rank: { color: tokens.text.primary, fontSize: 15, fontWeight: '800', minWidth: 44 }
  });
