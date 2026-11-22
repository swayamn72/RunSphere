import { describe, expect, it } from 'vitest';
import { RUN_MODE_CARDS, ghostRaceHint, pickRunMode } from './run-mode-model';

const rival = { owner: { isSelf: false }, ghostAvailable: true };
const mine = { owner: { isSelf: true }, ghostAvailable: true };
const closed = { owner: { isSelf: false }, ghostAvailable: false };

describe('run mode picker (M9 9.6)', () => {
  it('offers the four modes in order, one short line each', () => {
    expect(RUN_MODE_CARDS.map((card) => card.title)).toEqual([
      'Free run',
      'Turf',
      'Quest',
      'Ghost Race'
    ]);
    for (const card of RUN_MODE_CARDS) expect(card.line.length).toBeLessThanOrEqual(50);
  });

  it('starts Free and Turf runs straight away', () => {
    expect(pickRunMode('free')).toEqual({ kind: 'start', start: { mode: 'free' } });
    expect(pickRunMode('turf')).toEqual({ kind: 'start', start: { mode: 'turf' } });
  });

  it('asks for a quest or a rival’s ground before the other two can start', () => {
    expect(pickRunMode('quest')).toEqual({ kind: 'choose-quest' });
    expect(pickRunMode('ghost')).toEqual({ kind: 'choose-ground' });
  });

  it('says what to tap on the map, or why there is nothing to tap', () => {
    expect(ghostRaceHint([rival], 2)).toBe('Tap a rival’s ground to race it.');
    expect(ghostRaceHint([rival], undefined)).toBe('Tap a rival’s ground to race it.');
    expect(ghostRaceHint([rival], 0)).toMatch(/No ghost races left this hour/);
    expect(ghostRaceHint([], 3)).toMatch(/No rival ground to race here/);
    // Your own ground and ground whose holder turned races off can't be raced.
    expect(ghostRaceHint([mine, closed], 3)).toMatch(/No rival ground to race here/);
  });
});
