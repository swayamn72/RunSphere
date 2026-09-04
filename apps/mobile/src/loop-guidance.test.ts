import { describe, expect, it, vi } from 'vitest';
import { crewCharacters } from './crew';
import { isSafeMascotLabel } from './mascot';
import {
  createGuidanceStore,
  createMemoryGuidanceStore,
  emptyGuidanceMemory,
  guidanceDay,
  guidanceStore,
  isGuidanceEligible,
  loopGuidance,
  loopGuidanceCues,
  parseGuidanceMemory,
  recordGuidanceDismissed,
  recordGuidanceShown,
  recordWeekSeen,
  selectGuidance,
  setGuidanceStore,
  weeklyResetPending
} from './loop-guidance';

const at = (iso: string) => new Date(iso);

describe('guidance copy', () => {
  it('never claims authority, a reward, or a rejection', () => {
    for (const cue of loopGuidanceCues)
      expect(isSafeMascotLabel(loopGuidance[cue].message), cue).toBe(true);
  });

  it('is spoken by a real crew member', () => {
    for (const cue of loopGuidanceCues)
      expect(crewCharacters).toContain(loopGuidance[cue].character);
  });

  it('gives every crew member something to say, so no mascot is decorative only', () => {
    const speaking = new Set(loopGuidanceCues.map((cue) => loopGuidance[cue].character));
    expect([...speaking].sort()).toEqual([...crewCharacters].sort());
  });

  it('caps every cue, so no cue can repeat without limit', () => {
    for (const cue of loopGuidanceCues) {
      expect(loopGuidance[cue].maxPerDay).toBeGreaterThan(0);
      expect(loopGuidance[cue].dismissalDays).toBeGreaterThan(0);
    }
  });
});

describe('local day', () => {
  it('rolls over at Asia/Kolkata midnight, not UTC midnight', () => {
    expect(guidanceDay(at('2026-09-04T18:29:59.000Z'))).toBe('2026-09-04');
    expect(guidanceDay(at('2026-09-04T18:30:00.000Z'))).toBe('2026-09-05');
  });
});

describe('frequency cap', () => {
  it('allows a cue up to its daily maximum and no further', () => {
    const now = at('2026-09-04T09:00:00.000Z');
    let memory = emptyGuidanceMemory;
    expect(isGuidanceEligible(memory, 'challenge-invite', now)).toBe(true);
    memory = recordGuidanceShown(memory, 'challenge-invite', now);
    expect(isGuidanceEligible(memory, 'challenge-invite', now)).toBe(true);
    memory = recordGuidanceShown(memory, 'challenge-invite', now);
    expect(isGuidanceEligible(memory, 'challenge-invite', now)).toBe(false);
  });

  it('starts the count over on the next local day', () => {
    const memory = recordGuidanceShown(
      emptyGuidanceMemory,
      'play-empty',
      at('2026-09-04T09:00:00.000Z')
    );
    expect(isGuidanceEligible(memory, 'play-empty', at('2026-09-04T17:00:00.000Z'))).toBe(false);
    expect(isGuidanceEligible(memory, 'play-empty', at('2026-09-04T18:30:00.000Z'))).toBe(true);
  });

  it('counts each cue separately', () => {
    const now = at('2026-09-04T09:00:00.000Z');
    const memory = recordGuidanceShown(emptyGuidanceMemory, 'play-empty', now);
    expect(isGuidanceEligible(memory, 'play-empty', now)).toBe(false);
    expect(isGuidanceEligible(memory, 'quest-empty', now)).toBe(true);
  });
});

describe('dismissal', () => {
  it('holds for the stated number of days and then lapses', () => {
    const memory = recordGuidanceDismissed(
      emptyGuidanceMemory,
      'quest-empty',
      at('2026-09-04T09:00:00.000Z')
    );
    expect(isGuidanceEligible(memory, 'quest-empty', at('2026-09-09T09:00:00.000Z'))).toBe(false);
    expect(isGuidanceEligible(memory, 'quest-empty', at('2026-09-11T09:00:00.000Z'))).toBe(true);
  });

  it('silences only the dismissed cue', () => {
    const now = at('2026-09-04T09:00:00.000Z');
    const memory = recordGuidanceDismissed(emptyGuidanceMemory, 'quest-empty', now);
    expect(isGuidanceEligible(memory, 'play-empty', now)).toBe(true);
  });
});

describe('selectGuidance', () => {
  const now = at('2026-09-04T09:00:00.000Z');

  it('shows at most one cue, honouring the order the screen asked for', () => {
    expect(selectGuidance(['challenge-invite', 'play-empty'], emptyGuidanceMemory, now)).toBe(
      'challenge-invite'
    );
  });

  it('falls through to the next candidate when the first is spent', () => {
    const memory = recordGuidanceDismissed(emptyGuidanceMemory, 'challenge-invite', now);
    expect(selectGuidance(['challenge-invite', 'play-empty'], memory, now)).toBe('play-empty');
  });

  it('shows nothing when a surface offers nothing', () => {
    expect(selectGuidance([], emptyGuidanceMemory, now)).toBeUndefined();
  });
});

describe('weekly reset', () => {
  it('says nothing on a first run, when no earlier week was ever seen', () => {
    expect(weeklyResetPending(emptyGuidanceMemory, '2026-09-07')).toBe(false);
  });

  it('recognises a week boundary the reader has crossed', () => {
    const memory = recordWeekSeen(emptyGuidanceMemory, '2026-08-31');
    expect(weeklyResetPending(memory, '2026-09-07')).toBe(true);
    expect(weeklyResetPending(memory, '2026-08-31')).toBe(false);
  });

  it('keeps the same memory object when the week has not moved', () => {
    const memory = recordWeekSeen(emptyGuidanceMemory, '2026-08-31');
    expect(recordWeekSeen(memory, '2026-08-31')).toBe(memory);
  });

  it('says nothing when the surface has no week to report', () => {
    const memory = recordWeekSeen(emptyGuidanceMemory, '2026-08-31');
    expect(weeklyResetPending(memory, undefined)).toBe(false);
  });
});

describe('stored memory', () => {
  it('reads back what it wrote', () => {
    const memory = recordGuidanceShown(
      recordWeekSeen(emptyGuidanceMemory, '2026-08-31'),
      'play-empty',
      at('2026-09-04T09:00:00.000Z')
    );
    expect(parseGuidanceMemory(JSON.stringify(memory))).toEqual(memory);
  });

  it('treats absent or corrupt memory as a clean slate', () => {
    expect(parseGuidanceMemory(null)).toEqual(emptyGuidanceMemory);
    expect(parseGuidanceMemory('not json')).toEqual(emptyGuidanceMemory);
  });

  it('drops cues a later release no longer defines', () => {
    const raw = JSON.stringify({
      shown: { 'retired-cue': { day: '2026-09-04', count: 9 } },
      dismissed: { 'retired-cue': '2026-09-04' }
    });
    expect(parseGuidanceMemory(raw)).toEqual(emptyGuidanceMemory);
  });

  it('persists through the injected key-value store', async () => {
    const secure = {
      getItemAsync: vi.fn(async (_key: string) => null),
      setItemAsync: vi.fn(async (_key: string, _value: string) => undefined),
      deleteItemAsync: vi.fn(async (_key: string) => undefined)
    };
    const store = createGuidanceStore(secure);
    await expect(store.read()).resolves.toEqual(emptyGuidanceMemory);
    await store.save(recordWeekSeen(emptyGuidanceMemory, '2026-08-31'));
    expect(secure.setItemAsync.mock.calls[0]![0]).toBe('runsphere.guidance.memory');
  });
});

describe('store registry', () => {
  it('defaults to an in-memory store so no screen reaches a native module', async () => {
    await expect(guidanceStore().read()).resolves.toEqual(emptyGuidanceMemory);
  });

  it('uses the store the app installs', async () => {
    const previous = guidanceStore();
    const installed = createMemoryGuidanceStore(recordWeekSeen(emptyGuidanceMemory, '2026-08-31'));
    setGuidanceStore(installed);
    await expect(guidanceStore().read()).resolves.toEqual({
      shown: {},
      dismissed: {},
      lastWeekSeen: '2026-08-31'
    });
    setGuidanceStore(previous);
  });
});
