import { describe, expect, it, vi } from 'vitest';
import { isRhoTone } from './rho-coach.js';
import {
  TOUR_STEPS,
  TOUR_VERSION,
  createMemoryTourStore,
  createTourStore,
  shouldStartTour,
  tourLinesPassTone,
  tourProgress,
  tourReducer,
  tourStep
} from './tutorial-model.js';

describe('guided tour (M9 9.21)', () => {
  it('walks Run → modes → Map → Quests → your runs', () => {
    expect(TOUR_STEPS.map((step) => step.id)).toEqual(['run', 'modes', 'map', 'quests', 'runs']);
    expect(new Set(TOUR_STEPS.map((step) => step.id)).size).toBe(TOUR_STEPS.length);
  });

  it('moves next and back, and skip or the last Next ends it', () => {
    let state = tourReducer({ index: 0 }, 'back');
    expect(state).toEqual({ index: 0 });
    state = tourReducer(state, 'next');
    expect(tourStep(state)?.id).toBe('modes');
    expect(tourProgress(state)).toBe('Step 2 of 5');
    expect(tourReducer(state, 'skip')).toBe('done');
    expect(tourReducer({ index: TOUR_STEPS.length - 1 }, 'next')).toBe('done');
    expect(tourReducer('done', 'next')).toBe('done');
    expect(tourStep('done')).toBeUndefined();
  });

  it('speaks in Rho’s voice: short, kind, never about pace', () => {
    expect(tourLinesPassTone()).toBe(true);
    for (const step of TOUR_STEPS) {
      expect(isRhoTone(step.rhoLine)).toBe(true);
      expect(step.rhoLine.length).toBeLessThanOrEqual(90);
      expect(step.title.split(' ').length).toBeLessThanOrEqual(4);
    }
  });

  it('remembers per account that the tour was done, by version', async () => {
    const store = createMemoryTourStore();
    expect(await shouldStartTour('a', store)).toBe(true);
    await store.markDone('a');
    expect(await shouldStartTour('a', store)).toBe(false);
    expect(await shouldStartTour('b', store)).toBe(true);
    await store.markDone('b', TOUR_VERSION - 1);
    expect(await shouldStartTour('b', store)).toBe(true);
  });

  it('keeps only a version number in secure storage, and never blocks on a storage failure', async () => {
    const backing = new Map<string, string>();
    const secure = {
      getItemAsync: vi.fn(async (key: string) => backing.get(key) ?? null),
      setItemAsync: vi.fn(async (key: string, value: string) => void backing.set(key, value)),
      deleteItemAsync: vi.fn(async () => undefined)
    };
    const store = createTourStore(secure);
    await store.markDone('acc-1');
    expect([...backing.entries()]).toEqual([['runsphere.tour.acc-1', String(TOUR_VERSION)]]);
    expect(await store.completedVersion('acc-1')).toBe(TOUR_VERSION);

    const broken = createTourStore({
      getItemAsync: async () => {
        throw new Error('locked');
      },
      setItemAsync: async () => {
        throw new Error('locked');
      },
      deleteItemAsync: async () => undefined
    });
    expect(await broken.completedVersion('acc-1')).toBe(0);
    await expect(broken.markDone('acc-1')).resolves.toBeUndefined();
  });
});
