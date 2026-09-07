import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { H3_CLAIM_RESOLUTION, H3_VERSION, h3Indexer } from './h3-indexer.js';
import { DEFAULT_CLAIM_RULE, type ClaimRing } from './territory-claim.js';

/** A ~600 m x ~550 m block in Mumbai, `[longitude, latitude]`. */
const BLOCK: ClaimRing = [
  [72.85, 19.05],
  [72.856, 19.05],
  [72.856, 19.055],
  [72.85, 19.055]
];

describe('the pinned H3 binding', () => {
  it('names the version that is actually installed', () => {
    // ADR-0001 requires every claim to carry the library that produced its
    // cells. `H3_VERSION` is written by hand because h3-js exposes nothing at
    // runtime, so this is the check that keeps it honest across an upgrade.
    const manifest = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8')
    ) as { dependencies?: Record<string, string> };

    expect(manifest.dependencies?.['h3-js']).toBe(H3_VERSION);
  });

  it('is pinned exactly, with no range', () => {
    // A caret here would let a patch release change which cells a claim covers
    // between two deploys, and old claims would stop intersecting new ones.
    expect(H3_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('agrees with the rule about which resolution claims use', () => {
    expect(DEFAULT_CLAIM_RULE.h3Resolution).toBe(H3_CLAIM_RESOLUTION);
  });

  it('reads the ring as longitude-first', () => {
    // h3-js defaults to latitude-first and getting this wrong does not throw —
    // it silently returns cells on the other side of the world. 19N 72E is
    // Mumbai; 72N 19E is the Norwegian Sea.
    const cells = h3Indexer.cellsInRing(BLOCK, H3_CLAIM_RESOLUTION);
    expect(cells.length).toBeGreaterThan(0);

    const covered = h3Indexer.ringAround([...cells]);
    const longitudes = covered.map(([lng]) => lng);
    const latitudes = covered.map(([, lat]) => lat);

    expect(Math.min(...longitudes)).toBeGreaterThan(72.8);
    expect(Math.max(...longitudes)).toBeLessThan(72.9);
    expect(Math.min(...latitudes)).toBeGreaterThan(19);
    expect(Math.max(...latitudes)).toBeLessThan(19.1);
  });

  it('covers the block with cells that add up to about its area', () => {
    const cells = h3Indexer.cellsInRing(BLOCK, H3_CLAIM_RESOLUTION);
    const total = cells.length * h3Indexer.cellAreaSqm(cells[0]!);

    // ~600 m x ~550 m is roughly 330,000 m². Whole cells, so within ~10%.
    expect(total).toBeGreaterThan(295_000);
    expect(total).toBeLessThan(365_000);
  });

  it('reports the cell area the resolution actually has', () => {
    const [cell] = h3Indexer.cellsInRing(BLOCK, H3_CLAIM_RESOLUTION);

    // **Not the ~15 m² the guide claims for resolution 11.** ~1,963 m² is the
    // real figure, which is why a 5,000 m² carve floor is about two and a half
    // cells. `H3_CLAIM_RESOLUTION` records the consequence.
    expect(h3Indexer.cellAreaSqm(cell!)).toBeGreaterThan(1_900);
    expect(h3Indexer.cellAreaSqm(cell!)).toBeLessThan(2_050);
  });

  it('gives a cell its neighbours and never itself', () => {
    const [cell] = h3Indexer.cellsInRing(BLOCK, H3_CLAIM_RESOLUTION);
    const neighbours = h3Indexer.neighbours(cell!);

    expect(neighbours).toHaveLength(6);
    expect(neighbours).not.toContain(cell);
  });

  it('is symmetric about adjacency', () => {
    const [cell] = h3Indexer.cellsInRing(BLOCK, H3_CLAIM_RESOLUTION);
    const [neighbour] = h3Indexer.neighbours(cell!);

    expect(h3Indexer.neighbours(neighbour!)).toContain(cell);
  });

  it('draws a closed-ish outline around a cell set', () => {
    const cells = h3Indexer.cellsInRing(BLOCK, H3_CLAIM_RESOLUTION);
    const ring = h3Indexer.ringAround([...cells]);

    expect(ring.length).toBeGreaterThan(3);
    for (const [lng, lat] of ring) {
      expect(Number.isFinite(lng)).toBe(true);
      expect(Number.isFinite(lat)).toBe(true);
    }
  });

  it('has nothing to say about an empty or degenerate set', () => {
    expect(h3Indexer.cellsInRing([], H3_CLAIM_RESOLUTION)).toEqual([]);
    expect(h3Indexer.cellsInRing([[72.85, 19.05]], H3_CLAIM_RESOLUTION)).toEqual([]);
    expect(h3Indexer.ringAround([])).toEqual([]);
  });

  it('refuses to draw a set that mixes resolutions', () => {
    // Two sets at different resolutions intersect to nothing, which would hand
    // over held ground in silence. It throws instead.
    const coarse = h3Indexer.cellsInRing(BLOCK, 9);
    const fine = h3Indexer.cellsInRing(BLOCK, 11);

    expect(() => h3Indexer.ringAround([...coarse, ...fine])).toThrow(/mixes resolutions/);
  });
});
