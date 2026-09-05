import { describe, expect, it } from 'vitest';
import type { TerritoryLadderResponse, TerritoryMapResponse } from '@runsphere/contracts';
import {
  TERRITORY_LADDER_EMPTY_MESSAGE,
  TERRITORY_MAP_UNAVAILABLE_MESSAGE,
  territoryHeldSummary,
  territoryLadderEmptyReason,
  territoryLadderRows,
  territoryMapPlan,
  type CellBoundarySource
} from './territory-model.js';

const SEASON = '00000000-0000-4000-8000-0000000000b1';

const ladder = (overrides: Partial<TerritoryLadderResponse> = {}): TerritoryLadderResponse => ({
  seasonId: SEASON,
  participantCount: 0,
  entries: [],
  captureNote: 'capture is off',
  ladderNote: 'no names',
  ...overrides
});

const mapResponse = (overrides: Partial<TerritoryMapResponse> = {}): TerritoryMapResponse => ({
  seasonId: SEASON,
  h3Resolution: 9,
  cells: [],
  captureNote: 'capture is off',
  mapNote: 'areas reset weekly',
  ...overrides
});

/** A stand-in for the H3 library nothing here depends on yet. */
const squareBoundaries = (resolution = 9): CellBoundarySource => ({
  h3Version: 'fake-1',
  resolution,
  boundaryFor: (cellIndex) =>
    cellIndex === 'unknown'
      ? undefined
      : [
          [72, 19],
          [72.001, 19],
          [72.001, 19.001],
          [72, 19.001]
        ]
});

describe('the division ladder', () => {
  it('shows a position and a score and no name', () => {
    const rows = territoryLadderRows(
      ladder({
        division: 'newcomer',
        entries: [
          { rank: 1, points: 40, weeksScored: 3, isSelf: false },
          { rank: 2, points: 25, weeksScored: 2, isSelf: true }
        ]
      })
    );

    expect(rows.map((row) => row.rankLabel)).toEqual(['#1', '#2']);
    expect(rows[0]?.pointsLabel).toBe('40 points');
    // Every string a reader or a screen reader receives, checked for anything
    // that could name somebody. There is nothing in the model that could.
    expect(rows.map((row) => row.accessibilityLabel).join(' ')).not.toMatch(/@|name|handle/i);
  });

  it('announces the reader own row as theirs', () => {
    const rows = territoryLadderRows(
      ladder({
        division: 'newcomer',
        entries: [{ rank: 4, points: 1, weeksScored: 1, isSelf: true }]
      })
    );

    expect(rows[0]?.accessibilityLabel).toBe('You are #4, with 1 point across 1 week.');
  });

  it('tells somebody who has not joined something different from somebody waiting for a score', () => {
    expect(territoryLadderEmptyReason(ladder())).toBe('not-enrolled');
    expect(territoryLadderEmptyReason(ladder({ division: 'newcomer' }))).toBe('nothing-scored');
    expect(TERRITORY_LADDER_EMPTY_MESSAGE['not-enrolled']).toContain('Join the season');
    expect(TERRITORY_LADDER_EMPTY_MESSAGE['nothing-scored']).toContain('after the first full week');
  });

  it('has no empty reason once there is anything to show', () => {
    expect(
      territoryLadderEmptyReason(
        ladder({
          division: 'newcomer',
          entries: [{ rank: 1, points: 2, weeksScored: 1, isSelf: true }]
        })
      )
    ).toBeUndefined();
  });
});

describe('the season map', () => {
  const held = (count: number, selfAt: number[] = []) =>
    Array.from({ length: count }, (_unused, index) => ({
      cellIndex: `cell-${index}`,
      isSelf: selfAt.includes(index)
    }));

  it('draws a closed polygon per held cell and nothing else', () => {
    const plan = territoryMapPlan(
      mapResponse({ weekStartsOn: '2026-09-07', cells: held(2, [1]) }),
      squareBoundaries()
    );

    expect(plan.layer?.features).toHaveLength(2);
    const first = plan.layer?.features[0];
    expect(first?.geometry.coordinates[0]).toHaveLength(5); // four corners, ring closed
    // ADR-0008: a cell may say that it is held and nothing about who holds it.
    expect(Object.keys(first?.properties ?? {})).toEqual(['isSelf']);
  });

  it('carries no timestamp, no route, and no holder anywhere in the layer', () => {
    const plan = territoryMapPlan(
      mapResponse({ weekStartsOn: '2026-09-07', cells: held(3, [0]) }),
      squareBoundaries()
    );

    const serialized = JSON.stringify(plan.layer);
    expect(serialized).not.toMatch(/account|participant|holder|at"|time|since/i);
  });

  it('refuses to draw at the wrong resolution rather than drawing the wrong size', () => {
    // A cell one resolution out is roughly seven times the area, which would
    // put a claim on ground nobody covered.
    const plan = territoryMapPlan(
      mapResponse({ weekStartsOn: '2026-09-07', cells: held(1) }),
      squareBoundaries(8)
    );

    expect(plan.unavailable).toBe('no-boundaries');
    expect(plan.layer).toBeUndefined();
  });

  it('says the map cannot be drawn rather than showing an empty city', () => {
    const plan = territoryMapPlan(
      mapResponse({ weekStartsOn: '2026-09-07', cells: held(4, [0, 1]) }),
      undefined
    );

    expect(plan.unavailable).toBe('no-boundaries');
    // The count survives, so somebody is still told their areas are counted.
    expect(plan.heldCount).toBe(4);
    expect(plan.selfCount).toBe(2);
    expect(TERRITORY_MAP_UNAVAILABLE_MESSAGE['no-boundaries']).toContain('still counted');
  });

  it('distinguishes not having joined from nothing being held', () => {
    expect(territoryMapPlan(mapResponse(), squareBoundaries()).unavailable).toBe('not-enrolled');
    expect(
      territoryMapPlan(mapResponse({ weekStartsOn: '2026-09-07' }), squareBoundaries()).unavailable
    ).toBe('nothing-held');
    expect(TERRITORY_MAP_UNAVAILABLE_MESSAGE['nothing-held']).toContain('reset every week');
  });

  it('drops a cell the boundary source does not recognise', () => {
    const plan = territoryMapPlan(
      mapResponse({
        weekStartsOn: '2026-09-07',
        cells: [
          { cellIndex: 'unknown', isSelf: false },
          { cellIndex: 'cell-1', isSelf: true }
        ]
      }),
      squareBoundaries()
    );

    expect(plan.layer?.features).toHaveLength(1);
  });

  it('summarises what is held without a rank or a pace', () => {
    const plan = territoryMapPlan(
      mapResponse({ weekStartsOn: '2026-09-07', cells: held(3, [0]) }),
      squareBoundaries()
    );

    expect(territoryHeldSummary(plan)).toBe('1 area yours of 3 areas held this week.');
    expect(territoryHeldSummary({ heldCount: 0, selfCount: 0 })).toBe('No areas held this week.');
  });
});
