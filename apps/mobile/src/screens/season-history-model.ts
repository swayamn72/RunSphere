import type {
  TerritoryClaimSeasonListResponse,
  TerritoryClaimSeasonRecapResponse,
  TerritoryHallOfFameEntry,
  TerritoryHallOfFameResponse
} from '@runsphere/contracts';
import { formatArea } from './territory-claim-model';

/**
 * Season recap, hall of fame and the list of seasons (M2.5, M2.6). The server
 * decides what exists; this only words it, per `docs/voice.md`: numbers first,
 * honest when there is nothing to show.
 */
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
];

/** `2026-10` as `October 2026`. */
export const monthLabel = (seasonMonth: string): string => {
  const [year, month] = seasonMonth.split('-');
  const name = MONTHS[Number(month) - 1];
  return name && year ? `${name} ${year}` : seasonMonth;
};

export interface RecapView {
  readonly title: string;
  readonly headline: string;
  readonly lines: readonly string[];
}

export const RECAP_EMPTY: Readonly<Record<'no_finished_season' | 'held_nothing', string>> = {
  no_finished_season: 'No season has finished yet. Your recap lands when this one resets.',
  held_nothing: "You didn't hold any ground last season. Close a loop to start this one."
};

export const recapView = (
  response: TerritoryClaimSeasonRecapResponse
): RecapView | { readonly empty: string } => {
  const { recap } = response;
  if (!recap) return { empty: RECAP_EMPTY[response.unavailableReason ?? 'no_finished_season'] };
  const place = recap.cityTag ? ` in ${recap.cityTag}` : '';
  return {
    title: `${monthLabel(recap.seasonMonth)} recap`,
    headline: `#${recap.rank}${place} with ${formatArea(recap.finalAreaSqm)}`,
    lines: [
      `Peak ground: ${formatArea(recap.peakAreaSqm)}`,
      `${recap.claimCount} ${recap.claimCount === 1 ? 'claim' : 'claims'}`,
      `Longest held: ${recap.longestHeldDays} ${recap.longestHeldDays === 1 ? 'day' : 'days'}`,
      ...recap.records.map((record) => `Record: ${recordLabel(record)}`)
    ]
  };
};

const RECORD_NAME: Readonly<Record<TerritoryHallOfFameEntry['recordType'], string>> = {
  largest_holding: 'Most ground held',
  largest_claim: 'Biggest single loop'
};

export const recordLabel = (entry: TerritoryHallOfFameEntry): string =>
  `${RECORD_NAME[entry.recordType]}, ${formatArea(entry.valueSqm)}`;

export interface RecordRow {
  readonly key: string;
  readonly title: string;
  readonly detail: string;
}

export const recordRows = (response: TerritoryHallOfFameResponse): readonly RecordRow[] =>
  response.entries.map((entry) => ({
    key: `${entry.recordType}:${entry.seasonMonth}`,
    title: recordLabel(entry),
    detail: `${entry.displayName} · ${monthLabel(entry.seasonMonth)}`
  }));

export const HALL_EMPTY: Readonly<Record<'no_place_yet' | 'none', string>> = {
  no_place_yet: 'Records appear once your ground is on the map.',
  none: 'No records yet. The first big loop sets one.'
};

export const hallEmptyMessage = (response: TerritoryHallOfFameResponse): string | undefined =>
  response.entries.length > 0
    ? undefined
    : HALL_EMPTY[response.unavailableReason === 'no_place_yet' ? 'no_place_yet' : 'none'];

export interface SeasonRow {
  readonly key: string;
  readonly title: string;
  readonly detail: string;
}

/** Newest first, the current season marked as running. */
export const seasonRows = (list: TerritoryClaimSeasonListResponse): readonly SeasonRow[] =>
  [...list.data]
    .sort((a, b) => b.seasonMonth.localeCompare(a.seasonMonth))
    .map((season) => ({
      key: season.seasonMonth,
      title: monthLabel(season.seasonMonth),
      detail: season.isCurrent
        ? 'Running now'
        : `${season.claimsArchived} ${season.claimsArchived === 1 ? 'claim' : 'claims'} held at the end`
    }));

export const SEASONS_EMPTY = 'No seasons yet.';
