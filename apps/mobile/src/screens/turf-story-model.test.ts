import { describe, expect, it } from 'vitest';
import { DEFAULT_CLAIM_RULE, minCarveArea } from '@runsphere/domain';
import {
  STORY_AREAS,
  STORY_SCENES,
  clipConvex,
  createMemoryTurfStoryStore,
  createTurfStoryStore,
  formatArea,
  markTurfStorySeen,
  ringArea,
  shouldShowTurfStory,
  storyFrame
} from './turf-story-model';

describe('How Turf works story', () => {
  it('tells the game in order: run, claim, steal, defend, season', () => {
    expect(STORY_SCENES.map((scene) => scene.id)).toEqual([
      'run',
      'claim',
      'steal',
      'defend',
      'season'
    ]);
    for (const scene of STORY_SCENES) {
      expect(scene.title.length).toBeLessThanOrEqual(26);
      expect(scene.body.length).toBeLessThanOrEqual(100);
    }
  });

  it('says a steal needs speed, because the game does', () => {
    const steal = STORY_SCENES.find((scene) => scene.id === 'steal')!;
    expect(steal.body).toMatch(/faster/);
  });

  it('only shows shapes a real claim could be', () => {
    const rule = DEFAULT_CLAIM_RULE;
    expect(STORY_AREAS.yours).toBeGreaterThanOrEqual(rule.minAreaSqm);
    expect(STORY_AREAS.rival).toBeGreaterThanOrEqual(rule.minAreaSqm);
    // The steal is big enough to carve under the real rule, and smaller than what it cuts.
    expect(STORY_AREAS.taken).toBeGreaterThanOrEqual(
      minCarveArea(Math.min(STORY_AREAS.rival, STORY_AREAS.yours), rule)
    );
    expect(STORY_AREAS.taken).toBeLessThan(STORY_AREAS.rival);
  });

  it('draws the loop as it is run, and closes it at the end', () => {
    const start = storyFrame('run', 0.1);
    const end = storyFrame('run', 1);
    expect(start.trail!.length).toBeLessThan(end.trail!.length);
    expect(end.trail![0]![0]).toBeCloseTo(end.trail![end.trail!.length - 1]![0], 9);
    expect(end.head).toBeDefined();
  });

  it('counts the area up to the real figure', () => {
    expect(storyFrame('claim', 0).counter?.value).toBe(0);
    expect(storyFrame('claim', 1).counter).toEqual({ value: STORY_AREAS.yours, label: 'YOURS' });
    expect(storyFrame('steal', 0.5).counter).toBeUndefined();
    expect(storyFrame('steal', 1).counter).toEqual({ value: STORY_AREAS.taken, label: 'TAKEN' });
    expect(storyFrame('steal', 1).takenOpacity).toBe(1);
  });

  it('shows your ground under attack by a rival line when defending', () => {
    const frame = storyFrame('defend', 0.5);
    expect(frame.contested).toBeDefined();
    expect(frame.trailKind).toBe('rival');
  });

  it('fades everyone out for the new season', () => {
    expect(storyFrame('season', 1).yoursOpacity).toBeLessThan(0.3);
    expect(storyFrame('season', 1).rivals.length).toBeGreaterThan(3);
  });

  it('formats areas without the phone locale', () => {
    expect(formatArea(17_778)).toBe('17,778');
    expect(formatArea(950)).toBe('950');
    expect(formatArea(1_234_567)).toBe('1,234,567');
  });

  it('clips two convex shapes to their overlap', () => {
    const square = (x: number, y: number, size: number): [number, number][] => [
      [x, y],
      [x + size, y],
      [x + size, y + size],
      [x, y + size],
      [x, y]
    ];
    expect(ringArea(clipConvex(square(0, 0, 10), square(5, 5, 10)))).toBeCloseTo(25, 6);
    expect(clipConvex(square(0, 0, 1), square(5, 5, 1))).toEqual([]);
  });

  it('shows once per account and remembers it', async () => {
    const store = createMemoryTurfStoryStore();
    expect(await shouldShowTurfStory('a', store)).toBe(true);
    await markTurfStorySeen('a', store);
    expect(await shouldShowTurfStory('a', store)).toBe(false);
    expect(await shouldShowTurfStory('b', store)).toBe(true);
  });

  it('treats an unreadable device store as not seen, and never throws on save', async () => {
    const store = createTurfStoryStore({
      getItemAsync: async () => {
        throw new Error('locked');
      },
      setItemAsync: async () => {
        throw new Error('locked');
      },
      deleteItemAsync: async () => undefined
    });
    expect(await shouldShowTurfStory('a', store)).toBe(true);
    await expect(markTurfStorySeen('a', store)).resolves.toBeUndefined();
  });
});
