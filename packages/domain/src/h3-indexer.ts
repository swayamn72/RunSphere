import {
  cellArea,
  cellToLatLng,
  cellsToMultiPolygon,
  getResolution,
  gridDisk,
  latLngToCell,
  polygonToCells,
  UNITS
} from 'h3-js';
import type { ClaimRing, H3Indexer } from './territory-claim.js';

/**
 * The one place this product binds to H3 (ADR-0001).
 *
 * `territory-claim.ts` owns the carving *rules* and stays pure: it takes an
 * `H3Indexer` and never imports a library. This file is the only implementation
 * of that interface, and the only file that knows what H3 is. The direction is
 * one-way — this imports the rules, the rules never import this — so the game
 * can be reasoned about and tested without a hexagon anywhere in sight.
 *
 * **Why the version is a constant and not read from the package.**
 * ADR-0001 requires every stored contribution to name the library that produced
 * it, so a disputed claim can be recomputed with the same code that decided it.
 * `h3-js` exports no version at runtime, and reading `package.json` from an ESM
 * build is a bundler problem in every consumer. So it is written down here, and
 * `h3-indexer.test.ts` asserts it against the pinned dependency — a drift on
 * upgrade fails the suite rather than silently mislabelling claims.
 */
export const H3_VERSION = '4.1.0';

/**
 * How fine the carving grid is.
 *
 * **The specification contradicts itself here and this resolves it toward the
 * number, not the annotation.** `territory-guide.md` says "resolution 11 (~15 m²
 * per cell)"; H3 resolution 11 is ~1,963 m² per cell, and ~15 m² is closer to
 * resolution 14. The explicit schema default in the plan is 11, so 11 is what
 * ships, with two consequences worth knowing before anybody changes it:
 *
 *   * The minimum claim (5,000 m²) is about 2.5 cells, so `minCarveArea` is a
 *     threshold measured in units of ~40% of itself. Carve areas are reported
 *     from the cell count, so they land on ~1,963 m² steps.
 *   * Resolution 12 (~280 m²) would make a minimum claim 18 cells and a carve
 *     legible, at ~7x the stored cells per claim. A 5 km² claim would hold
 *     ~17,800 cell strings instead of ~2,500.
 *
 * It is stored per claim and published in the rule version, so moving it is a
 * reviewed migration rather than a deploy — and old claims keep being scored by
 * the resolution they were made at.
 */
export const H3_CLAIM_RESOLUTION = 11;

/**
 * A cell set is only ever compared with another cell set at the same
 * resolution. Mixing them would silently intersect nothing, so it throws.
 */
const assertSameResolution = (cells: readonly string[]): void => {
  if (cells.length === 0) return;
  const resolution = getResolution(cells[0]!);
  for (const cell of cells) {
    if (getResolution(cell) !== resolution)
      throw new Error('H3 cell set mixes resolutions, which cannot be compared');
  }
};

/**
 * The pinned binding. Every method is a thin pass-through; the only judgement
 * in this file is the coordinate order and the two guards above.
 */
export const h3Indexer: H3Indexer = {
  version: H3_VERSION,

  /**
   * `isGeoJson: true` because a `ClaimRing` is `[longitude, latitude]` and
   * h3-js defaults to `[latitude, longitude]`. Getting this wrong does not
   * throw — it returns cells on the other side of the world — so it is passed
   * explicitly at the one call site rather than left to a default.
   */
  cellsInRing: (ring: ClaimRing, resolution: number): readonly string[] =>
    ring.length < 3
      ? []
      : polygonToCells(
          ring.map(([lng, lat]) => [lng, lat]),
          resolution,
          true
        ),

  cellAreaSqm: (cell: string): number => cellArea(cell, UNITS.m2),

  /** `gridDisk` radius 1 includes the cell itself; a neighbour is not itself. */
  neighbours: (cell: string): readonly string[] =>
    gridDisk(cell, 1).filter((candidate) => candidate !== cell),

  /**
   * The outer ring of a contiguous cell set.
   *
   * Callers pass a set that has already been reduced to one connected
   * component, so this is one polygon. Its holes are dropped: a claim boundary
   * is a single ring in the contract, and a doughnut of held ground drawn as a
   * filled blob overstates the ground by the size of the hole — which is
   * visible, arguable, and much better than the alternative of failing to draw
   * the claim at all. The authoritative area is always the cell count.
   */
  ringAround: (cells: readonly string[]): ClaimRing => {
    if (cells.length === 0) return [];
    assertSameResolution(cells);
    const polygons = cellsToMultiPolygon([...cells], true);
    const outer = polygons[0]?.[0];
    if (!outer) return [];
    return outer.flatMap((pair) =>
      typeof pair[0] === 'number' && typeof pair[1] === 'number'
        ? [[pair[0], pair[1]] as readonly [number, number]]
        : []
    );
  },

  cellAt: (latitude: number, longitude: number, resolution: number): string =>
    latLngToCell(latitude, longitude, resolution),

  /** h3-js returns `[lat, lng]`; a `ClaimRing` coordinate is the other way. */
  cellCentre: (cell: string): readonly [number, number] => {
    const [latitude, longitude] = cellToLatLng(cell);
    return [longitude, latitude];
  }
};
