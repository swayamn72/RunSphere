import type { SecureKeyValueStore } from './auth-storage-core';
import { isRhoTone } from './rho-coach';
import type { Tab } from './navigation/types';

/**
 * The guided tour (M9 9.21–9.25): Rho walks a new runner through the app one
 * spotlit button at a time. This file is the tour itself and its memory; the
 * overlay that draws it is `TutorialOverlay.tsx` and buttons register where
 * they are with `TutorialTarget`.
 *
 * Completion is remembered per account on this device, with a version: bump
 * `TOUR_VERSION` when the tour changes enough to be worth showing again.
 * "Replay the tour" in Settings starts it any time.
 */

export const TOUR_VERSION = 1;

/** Where the speech bubble sits relative to the spotlit button. */
export type TourPlacement = 'above' | 'below';

export interface TourStep {
  id: string;
  /** The `TutorialTarget` id to spotlight. */
  targetId: string;
  /** The tab that must be showing for the target to be on screen. */
  tab: Tab;
  title: string;
  rhoLine: string;
  placement: TourPlacement;
}

/** The first tour after sign-up (9.25). Every line passes Rho's tone test. */
export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: 'run',
    targetId: 'tab-run',
    tab: 'Home',
    title: 'Start a run',
    rhoLine: 'Tap Run whenever you head out. I’ll keep count of the distance.',
    placement: 'above'
  },
  {
    id: 'modes',
    targetId: 'home-start',
    tab: 'Home',
    title: 'Three ways to run',
    rhoLine: 'Free run, Turf or Quest. Pick one before you start.',
    placement: 'below'
  },
  {
    id: 'map',
    targetId: 'tab-map',
    tab: 'Map',
    title: 'Your ground',
    rhoLine: 'Close a loop on a Turf run and the ground inside is yours on the map.',
    placement: 'above'
  },
  {
    id: 'quests',
    targetId: 'home-quests',
    tab: 'Home',
    title: 'Quests',
    rhoLine: 'Quests are routes worth running. Take one on, then run it as a Quest run.',
    placement: 'above'
  },
  {
    id: 'runs',
    targetId: 'tab-profile',
    tab: 'Profile',
    title: 'Your runs',
    rhoLine: 'Every run that counts lands on your profile, with splits and the route.',
    placement: 'above'
  }
];

export type TourAction = 'next' | 'back' | 'skip';

/** The step showing, or `done`. */
export type TourState = { index: number } | 'done';

export const tourReducer = (state: TourState, action: TourAction): TourState => {
  if (state === 'done') return state;
  if (action === 'skip') return 'done';
  if (action === 'back') return { index: Math.max(0, state.index - 1) };
  return state.index + 1 >= TOUR_STEPS.length ? 'done' : { index: state.index + 1 };
};

export const tourStep = (state: TourState): TourStep | undefined =>
  state === 'done' ? undefined : TOUR_STEPS[state.index];

/** "Step 2 of 5", for the bubble and for TalkBack. */
export const tourProgress = (state: TourState): string =>
  state === 'done' ? '' : `Step ${state.index + 1} of ${TOUR_STEPS.length}`;

export const tourLinesPassTone = (): boolean => TOUR_STEPS.every((step) => isRhoTone(step.rhoLine));

export interface TourStore {
  /** The tour version this account finished or skipped, or 0. */
  completedVersion(accountId: string): Promise<number>;
  markDone(accountId: string, version?: number): Promise<void>;
}

const keyFor = (accountId: string) => `runsphere.tour.${accountId.replace(/[^a-zA-Z0-9._-]/g, '')}`;

/** Per account, on this device. Holds a version number and nothing else. */
export const createTourStore = (store: SecureKeyValueStore): TourStore => ({
  async completedVersion(accountId) {
    try {
      const raw = await store.getItemAsync(keyFor(accountId));
      const version = Number(raw);
      return Number.isInteger(version) && version > 0 ? version : 0;
    } catch {
      return 0;
    }
  },
  async markDone(accountId, version = TOUR_VERSION) {
    try {
      await store.setItemAsync(keyFor(accountId), String(version));
    } catch {
      // A tour shown twice is better than an app that can't move on.
    }
  }
});

export const createMemoryTourStore = (): TourStore => {
  const done = new Map<string, number>();
  return {
    completedVersion: (accountId) => Promise.resolve(done.get(accountId) ?? 0),
    markDone: (accountId, version = TOUR_VERSION) => {
      done.set(accountId, version);
      return Promise.resolve();
    }
  };
};

let activeTourStore: TourStore = createMemoryTourStore();

/** App installs the secure store at startup, as it does for guidance memory. */
export const setTourStore = (store: TourStore): void => {
  activeTourStore = store;
};
export const tourStore = (): TourStore => activeTourStore;

export const shouldStartTour = async (accountId: string, store = tourStore()) =>
  (await store.completedVersion(accountId)) < TOUR_VERSION;
