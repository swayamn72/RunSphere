import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Text } from '../components/Text';
import type {
  TerritoryClaimSeasonListResponse,
  TerritoryClaimSeasonRecapResponse,
  TerritoryHallOfFameResponse
} from '@runsphere/contracts';
import type { MobileApiClient } from '../api-client';
import {
  SEASONS_EMPTY,
  hallEmptyMessage,
  recapView,
  recordRows,
  seasonRows
} from './season-history-model';

/** The few style keys this needs; PlayScreen's local styles provide them. */
export interface SeasonHistoryStyles {
  readonly sectionHeader: object;
  readonly sectionTitle: object;
  readonly card: object;
  readonly cardTitle: object;
  readonly body: object;
  readonly helper: object;
}

type Api = Pick<
  MobileApiClient,
  'getTerritorySeasonRecap' | 'getTerritoryHallOfFame' | 'getTerritorySeasons'
>;

/**
 * The reader's last-season recap, the all-time records near them and the
 * seasons there have been (M2.5, M2.6). Each part loads on its own, so one
 * failing leaves the others; a part that fails simply isn't shown.
 */
export function SeasonHistory({
  api,
  styles
}: {
  api: Api;
  /** The host screen's own styles, so this matches the cards around it. */
  styles: SeasonHistoryStyles;
}) {
  const [recap, setRecap] = useState<TerritoryClaimSeasonRecapResponse>();
  const [hall, setHall] = useState<TerritoryHallOfFameResponse>();
  const [seasons, setSeasons] = useState<TerritoryClaimSeasonListResponse>();

  useEffect(() => {
    let active = true;
    const keep =
      <T,>(set: (value: T) => void) =>
      (value: T) => {
        if (active) set(value);
      };
    void api
      .getTerritorySeasonRecap()
      .then(keep(setRecap))
      .catch(() => undefined);
    void api
      .getTerritoryHallOfFame()
      .then(keep(setHall))
      .catch(() => undefined);
    void api
      .getTerritorySeasons()
      .then(keep(setSeasons))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [api]);

  const recapCard = recap ? recapView(recap) : undefined;
  const hallEmpty = hall ? hallEmptyMessage(hall) : undefined;
  const seasonList = seasons ? seasonRows(seasons) : [];

  return (
    <>
      {recapCard && (
        <>
          <View style={styles.sectionHeader}>
            <Text accessibilityRole="header" style={styles.sectionTitle}>
              Last season
            </Text>
          </View>
          <View style={styles.card}>
            {'empty' in recapCard ? (
              <Text style={styles.body}>{recapCard.empty}</Text>
            ) : (
              <>
                <Text style={styles.cardTitle}>{recapCard.title}</Text>
                <Text style={styles.body}>{recapCard.headline}</Text>
                {recapCard.lines.map((line) => (
                  <Text key={line} style={styles.helper}>
                    {line}
                  </Text>
                ))}
              </>
            )}
          </View>
        </>
      )}
      {hall && (
        <>
          <View style={styles.sectionHeader}>
            <Text accessibilityRole="header" style={styles.sectionTitle}>
              Hall of fame
            </Text>
          </View>
          <View style={styles.card}>
            {hallEmpty ? (
              <Text style={styles.body}>{hallEmpty}</Text>
            ) : (
              recordRows(hall).map((row) => (
                <View key={row.key} accessible accessibilityLabel={`${row.title}. ${row.detail}`}>
                  <Text style={styles.cardTitle}>{row.title}</Text>
                  <Text style={styles.helper}>{row.detail}</Text>
                </View>
              ))
            )}
            <Text style={styles.helper}>{hall.note}</Text>
          </View>
        </>
      )}
      {seasons && (
        <>
          <View style={styles.sectionHeader}>
            <Text accessibilityRole="header" style={styles.sectionTitle}>
              Seasons
            </Text>
          </View>
          <View style={styles.card}>
            {seasonList.length === 0 ? (
              <Text style={styles.body}>{SEASONS_EMPTY}</Text>
            ) : (
              seasonList.map((row) => (
                <View key={row.key} accessible accessibilityLabel={`${row.title}. ${row.detail}`}>
                  <Text style={styles.cardTitle}>{row.title}</Text>
                  <Text style={styles.helper}>{row.detail}</Text>
                </View>
              ))
            )}
          </View>
        </>
      )}
    </>
  );
}
