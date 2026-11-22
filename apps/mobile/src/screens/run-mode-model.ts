import type { RunMode } from '@runsphere/contracts';
import { FREE_RUN, TURF_RUN, type RunStart } from '../run-start';

/**
 * The Run tab's mode picker (M9 9.6). Four cards, one line each on what that
 * run does, so the choice is made before the run and not discovered after it
 * (plan section 1, decision 1). The lines say what the run *can* do; the
 * server still decides what it did.
 */
export interface RunModeCard {
  readonly mode: RunMode;
  readonly title: string;
  readonly line: string;
}

export const RUN_MODE_CARDS: readonly RunModeCard[] = [
  { mode: 'free', title: 'Free run', line: 'Just run. Distance, time and pace.' },
  { mode: 'turf', title: 'Turf', line: 'Close a loop to claim the ground inside it.' },
  { mode: 'quest', title: 'Quest', line: 'Pass every stop of a quest you’ve taken on.' },
  { mode: 'ghost', title: 'Ghost Race', line: 'Race a rival’s loop to take their ground.' }
];

/**
 * What picking a card does. Free and Turf need nothing and go straight to the
 * prepare screen. A Quest run needs a quest you've taken on, so it opens the
 * quests; a Ghost Race needs a rival's ground, so it opens the map. Neither
 * starts until that choice is made, because the server would refuse a run
 * without it.
 */
export type RunModePick =
  | { readonly kind: 'start'; readonly start: RunStart }
  | { readonly kind: 'choose-quest' }
  | { readonly kind: 'choose-ground' };

export const pickRunMode = (mode: RunMode): RunModePick =>
  mode === 'free'
    ? { kind: 'start', start: FREE_RUN }
    : mode === 'turf'
      ? { kind: 'start', start: TURF_RUN }
      : mode === 'quest'
        ? { kind: 'choose-quest' }
        : { kind: 'choose-ground' };

/**
 * The line over the map after picking Ghost Race. It tells the runner what to
 * tap, or why there's nothing to tap yet, using only what the map has loaded:
 * the hourly limit from the claim summary, and the rival ground in view that
 * allows races.
 */
export const ghostRaceHint = (
  claims: readonly {
    readonly owner: { readonly isSelf: boolean };
    readonly ghostAvailable?: boolean;
  }[],
  racesLeft: number | undefined
): string => {
  if (racesLeft === 0) return 'No ghost races left this hour. Try again soon.';
  if (!claims.some((claim) => !claim.owner.isSelf && claim.ghostAvailable === true))
    return 'No rival ground to race here. Move the map to find some.';
  return 'Tap a rival’s ground to race it.';
};
