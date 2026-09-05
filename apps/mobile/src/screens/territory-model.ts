import type { FeatureCollection, Polygon } from 'geojson';
import type { TerritoryLadderResponse, TerritoryMapResponse } from '@runsphere/contracts';

/**
 * The season ladder and the season map as the app shows them (Phase 4,
 * milestones 4.4 and 4.5).
 *
 * Both are read models over responses that are empty today, because territory
 * capture is off. What they mostly encode is the honest empty state: a screen
 * that shows a blank map or a blank list is indistinguishable from one that is
 * broken, and "territory" is a name that promises a great deal more than this
 * product currently does.
 */

/** One row of the division ladder. There is no name here, by design. */
export interface TerritoryLadderRow {
  readonly rankLabel: string;
  readonly pointsLabel: string;
  readonly weeksLabel: string;
  readonly isSelf: boolean;
  readonly accessibilityLabel: string;
}

const plural = (count: number, singular: string, many: string): string =>
  `${count} ${count === 1 ? singular : many}`;

export const territoryLadderRows = (ladder: TerritoryLadderResponse): TerritoryLadderRow[] =>
  ladder.entries.map((entry) => {
    const rankLabel = `#${entry.rank}`;
    const pointsLabel = plural(entry.points, 'point', 'points');
    const weeksLabel = plural(entry.weeksScored, 'week', 'weeks');
    return {
      rankLabel,
      pointsLabel,
      weeksLabel,
      isSelf: entry.isSelf,
      // The reader's own row is announced as theirs. Every other row is
      // announced as a position and a number, because that is all it is.
      accessibilityLabel: entry.isSelf
        ? `You are ${rankLabel}, with ${pointsLabel} across ${weeksLabel}.`
        : `${rankLabel}, ${pointsLabel} across ${weeksLabel}.`
    };
  });

/**
 * Why a ladder is showing nothing. Each is a different sentence to a reader,
 * and collapsing them into one empty list would tell somebody who has not
 * joined the same thing it tells somebody whose season has not scored yet.
 */
export type TerritoryLadderEmptyReason = 'not-enrolled' | 'nothing-scored';

export const territoryLadderEmptyReason = (
  ladder: TerritoryLadderResponse
): TerritoryLadderEmptyReason | undefined => {
  if (ladder.entries.length > 0) return undefined;
  return ladder.division ? 'nothing-scored' : 'not-enrolled';
};

export const TERRITORY_LADDER_EMPTY_MESSAGE: Readonly<Record<TerritoryLadderEmptyReason, string>> =
  {
    'not-enrolled': 'Join the season to see your group and where you sit in it.',
    'nothing-scored':
      'Nothing has been scored yet. Areas are counted once a week has finished, so the first standings appear after the first full week.'
  };

/**
 * Turns an H3 index into the ring of `[longitude, latitude]` points that
 * outlines it.
 *
 * **Nothing implements this.** No H3 library is a dependency of this app, and
 * ADR-0001 requires the library and resolution to be pinned wherever an index
 * is produced or read — so the boundary source is injected and carries its own
 * version rather than the map assuming one, exactly as the server-side indexer
 * does.
 */
export interface CellBoundarySource {
  readonly h3Version: string;
  readonly resolution: number;
  boundaryFor(cellIndex: string): readonly (readonly [number, number])[] | undefined;
}

/**
 * Why the map is not drawing cells. Named rather than collapsed into an empty
 * map, because an empty map reads as "nobody holds anything here", which would
 * be a claim about a city rather than about this app's dependencies.
 */
export type TerritoryMapUnavailable = 'no-boundaries' | 'not-enrolled' | 'nothing-held';

export interface TerritoryMapPlan {
  readonly layer?: FeatureCollection<Polygon, { isSelf: boolean }>;
  readonly unavailable?: TerritoryMapUnavailable;
  /** How many cells are held this week, whether or not any can be drawn. */
  readonly heldCount: number;
  readonly selfCount: number;
}

/**
 * What the map should render.
 *
 * The resolution the boundary source works at has to match the season's, or the
 * outlines would be drawn at the wrong size — a cell one resolution out is
 * roughly seven times the area, which would put a claim on ground nobody
 * covered. A mismatch is treated as having no boundaries at all.
 */
export const territoryMapPlan = (
  map: TerritoryMapResponse,
  boundaries: CellBoundarySource | undefined
): TerritoryMapPlan => {
  const heldCount = map.cells.length;
  const selfCount = map.cells.filter((cell) => cell.isSelf).length;
  if (!map.weekStartsOn) return { unavailable: 'not-enrolled', heldCount, selfCount };
  if (heldCount === 0) return { unavailable: 'nothing-held', heldCount, selfCount };
  if (!boundaries || boundaries.resolution !== map.h3Resolution)
    return { unavailable: 'no-boundaries', heldCount, selfCount };

  const features = map.cells.flatMap((cell) => {
    const ring = boundaries.boundaryFor(cell.cellIndex);
    if (!ring || ring.length < 3) return [];
    // GeoJSON polygons close their own ring.
    const coordinates = [...ring.map(([lng, lat]) => [lng, lat]), [ring[0]![0], ring[0]![1]]];
    return [
      {
        type: 'Feature' as const,
        // Properties carry one bit and no identity: ADR-0008 allows a cell to
        // say that it is held, and nothing about who holds it.
        properties: { isSelf: cell.isSelf },
        geometry: { type: 'Polygon' as const, coordinates: [coordinates] }
      }
    ];
  });
  if (features.length === 0) return { unavailable: 'no-boundaries', heldCount, selfCount };
  return {
    layer: { type: 'FeatureCollection', features },
    heldCount,
    selfCount
  };
};

export const TERRITORY_MAP_UNAVAILABLE_MESSAGE: Readonly<Record<TerritoryMapUnavailable, string>> =
  {
    'not-enrolled': 'Join the season to see the areas your group is playing for.',
    'nothing-held':
      'No areas are held this week yet. Areas reset every week, so this fills in as the week goes on.',
    'no-boundaries':
      'The map cannot be drawn in this version of the app. Your areas are still counted — update the app to see them.'
  };

/** How many areas the reader holds, said plainly and without a rank. */
export const territoryHeldSummary = (plan: TerritoryMapPlan): string =>
  plan.heldCount === 0
    ? 'No areas held this week.'
    : `${plural(plan.selfCount, 'area', 'areas')} yours of ${plural(plan.heldCount, 'area', 'areas')} held this week.`;
