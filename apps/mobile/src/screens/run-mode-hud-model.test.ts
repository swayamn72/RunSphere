import { describe, expect, it } from 'vitest';
import {
  canClaim,
  countedNext,
  fallbackNote,
  hudModeOf,
  livePanels,
  pendingCopy,
  prepareCopy,
  resultCopy
} from './run-mode-hud-model';

describe('per-mode HUD and result (M9 9.7)', () => {
  it('shows a run from before modes as Turf, which is how it is still treated', () => {
    expect(hudModeOf(undefined)).toBe('turf');
    expect(hudModeOf({ mode: 'quest', questId: 'q' })).toBe('quest');
  });

  it('gives each mode only its own live panels', () => {
    expect(livePanels('free')).toEqual({
      loopGuide: false,
      ghost: false,
      questStops: false,
      routeGuide: false
    });
    expect(livePanels('turf')).toEqual({
      loopGuide: true,
      ghost: false,
      questStops: false,
      routeGuide: true
    });
    expect(livePanels('quest')).toEqual({
      loopGuide: false,
      ghost: false,
      questStops: true,
      routeGuide: false
    });
    expect(livePanels('ghost')).toEqual({
      loopGuide: true,
      ghost: true,
      questStops: false,
      routeGuide: false
    });
  });

  it('points only Turf and Ghost Race runs at the Map, matching what the server allows', () => {
    expect(['free', 'turf', 'quest', 'ghost'].filter((mode) => canClaim(mode as never))).toEqual([
      'turf',
      'ghost'
    ]);
    expect(pendingCopy('free')).not.toMatch(/Map|claim/i);
    expect(pendingCopy('quest')).not.toMatch(/Map|claim/i);
    expect(pendingCopy('turf')).toMatch(/claim turf/);
    expect(countedNext('free')).toBeUndefined();
    expect(countedNext('ghost')).toMatch(/claim the ground/);
    expect(resultCopy('free').lead).not.toMatch(/claim/i);
  });

  it('names the quest and the rival on the prepare card', () => {
    expect(prepareCopy('quest', { questTitle: 'River loop' }).title).toBe('River loop');
    expect(prepareCopy('ghost', { rivalName: 'Ravi' }).title).toBe('Race Ravi');
    expect(prepareCopy('free').points.join(' ')).toMatch(/doesn’t claim ground/);
  });

  it('says plainly when a run was kept in another mode', () => {
    expect(fallbackNote('ghost')).toMatch(/counts as a Turf run/);
    expect(fallbackNote('quest')).toMatch(/counts as a free run/);
    expect(fallbackNote(undefined)).toBeUndefined();
  });
});
