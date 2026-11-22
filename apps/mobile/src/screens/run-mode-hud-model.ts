import type { RunMode } from '@runsphere/contracts';
import type { RunStart } from '../run-start';
import { CLAIM_CHECKLIST, VERIFYING_RUN_COPY } from './activity-results-model';

/**
 * What each mode's prepare screen, live HUD and result say and show (M9 9.7).
 * One mode, one set of panels: a Free run shows stats and nothing else; Turf
 * adds the loop guide; a Quest run lists its stops; a Ghost Race adds the
 * ghost card to Turf's loop guide.
 *
 * A run recorded before modes existed (`runStart` absent) is shown as Turf,
 * because that is how the server still treats it: it can claim ground.
 */
export type HudMode = RunMode;

export const hudModeOf = (start: RunStart | undefined): HudMode => start?.mode ?? 'turf';

export const MODE_LABEL: Readonly<Record<HudMode, string>> = {
  free: 'FREE RUN',
  turf: 'TURF RUN',
  quest: 'QUEST RUN',
  ghost: 'GHOST RACE'
};

export interface LivePanels {
  /** The closing line back to the start, and Rho's "head back" cue. */
  readonly loopGuide: boolean;
  /** The ghost's line on the map and the who's-ahead card. */
  readonly ghost: boolean;
  /** The quest's stops, ticked off as they're passed. */
  readonly questStops: boolean;
  /** A suggested route drawn under the run. Suggestions are Turf loops. */
  readonly routeGuide: boolean;
}

export const livePanels = (mode: HudMode): LivePanels => ({
  loopGuide: mode === 'turf' || mode === 'ghost',
  ghost: mode === 'ghost',
  questStops: mode === 'quest',
  routeGuide: mode === 'turf'
});

/** Whether this run can claim ground once it counts (the server's rule, 9.4). */
export const canClaim = (mode: HudMode): boolean => mode === 'turf' || mode === 'ghost';

export interface PrepareCopy {
  readonly eyebrow: string;
  readonly title: string;
  readonly points: readonly string[];
}

export const prepareCopy = (
  mode: HudMode,
  extra: { questTitle?: string; rivalName?: string } = {}
): PrepareCopy => {
  if (mode === 'free')
    return {
      eyebrow: MODE_LABEL.free,
      title: 'Just run',
      points: [
        'Distance, time and pace. Nothing else to think about.',
        'This run doesn’t claim ground or count for a quest.'
      ]
    };
  if (mode === 'quest')
    return {
      eyebrow: MODE_LABEL.quest,
      title: extra.questTitle ?? 'Quest run',
      points: [
        'Pass every stop on this run, in any order.',
        'A stop counts once you pass within 30 m of it.',
        'This run doesn’t claim ground.'
      ]
    };
  if (mode === 'ghost')
    return {
      eyebrow: MODE_LABEL.ghost,
      title: extra.rivalName ? `Race ${extra.rivalName}` : 'Ghost Race',
      points: [
        'Their loop plays on your map at the pace they ran it.',
        'Close your loop faster to take the ground.'
      ]
    };
  return { eyebrow: MODE_LABEL.turf, title: 'How to Claim Turf', points: CLAIM_CHECKLIST };
};

export interface ResultCopy {
  readonly title: string;
  readonly lead: string;
}

/** The finish screen, before the run is saved. */
export const resultCopy = (mode: HudMode): ResultCopy => {
  if (mode === 'free')
    return {
      title: 'Run done',
      lead: 'Saved on this device. Your totals update once your run is checked.'
    };
  if (mode === 'quest')
    return { title: 'Quest run done', lead: 'Save it and we’ll check every stop once it’s in.' };
  if (mode === 'ghost')
    return {
      title: 'Race done',
      lead: 'Save it. Once your run counts, claim the ground on the Map.'
    };
  return {
    title: 'New ground covered',
    lead: 'Save it. Once your run counts, claim the ground on the Map.'
  };
};

/** Shown while the run is being checked. Only claiming modes point at the Map. */
export const pendingCopy = (mode: HudMode): string =>
  canClaim(mode)
    ? VERIFYING_RUN_COPY
    : mode === 'quest'
      ? 'Rho: Checking GPS and pace for fair play, then every stop of your quest.'
      : 'Rho: Checking GPS and pace for fair play. Your totals update once it’s done.';

/** Once the run counts: what this mode's run leads to next. */
export const countedNext = (mode: HudMode): string | undefined =>
  canClaim(mode)
    ? 'Open the Map to claim the ground inside your loop.'
    : mode === 'quest'
      ? 'Your quest shows as done once every stop is found on your run.'
      : undefined;

/**
 * Said when the server refused the mode the run started with and it was kept
 * in its fallback mode instead (`runStartFallback`). Plain about what changed
 * and what still works, so the runner isn't left wondering where a race went.
 */
export const fallbackNote = (refused: RunMode | undefined): string | undefined =>
  refused === 'ghost'
    ? 'That ground changed hands before your run was saved, so it counts as a Turf run. You can still claim your loop.'
    : refused === 'quest'
      ? 'That quest closed before your run was saved, so it counts as a free run.'
      : undefined;
