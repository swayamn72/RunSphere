import { describe, expect, it } from 'vitest';
import { lucideIcons } from '../components/lucide-icons';
import { WELCOME_FEATURES, turfHexCells } from './welcome-model';

describe('welcome screen model', () => {
  it('claims a cluster in the middle of the grid, not the whole of it', () => {
    const cells = turfHexCells();
    const claimed = cells.filter((cell) => cell.claimed);
    expect(claimed.length).toBeGreaterThanOrEqual(5);
    expect(claimed.length).toBeLessThan(cells.length / 4);
    expect(new Set(cells.map((cell) => cell.key)).size).toBe(cells.length);
  });

  it('draws closed hexagons with finite coordinates', () => {
    for (const cell of turfHexCells()) {
      expect(cell.path.match(/[ML]/g)).toHaveLength(6);
      expect(cell.path.endsWith('Z')).toBe(true);
      expect(cell.path).not.toMatch(/NaN|Infinity/);
    }
  });

  it('gives each feature an icon the app ships and a different one', () => {
    for (const feature of WELCOME_FEATURES) expect(lucideIcons[feature.icon]).toBeDefined();
    expect(new Set(WELCOME_FEATURES.map((f) => f.icon)).size).toBe(WELCOME_FEATURES.length);
  });
});
