import type { RunMode } from '@runsphere/contracts';

/**
 * What a run was started as (M9 9.5). Chosen before the run, written once with
 * the local session, and sent when the run is created on the server, which
 * enforces it: only Turf and Ghost Race runs claim ground, and a Quest run
 * completes only its own quest (plan section 1, decision 1).
 *
 * A union rather than a mode plus optional ids, so a quest run without its
 * quest, or a Turf run carrying a claim id, can't be built at all. Those are
 * exactly the bodies the server refuses with a 400.
 */
export type RunStart =
  | { readonly mode: 'free' }
  | { readonly mode: 'turf' }
  | { readonly mode: 'quest'; readonly questId: string }
  | { readonly mode: 'ghost'; readonly ghostClaimId: string };

export const FREE_RUN: RunStart = { mode: 'free' };
export const TURF_RUN: RunStart = { mode: 'turf' };

/** The fields `ActivityCreateRequestSchema` takes for this start. */
export const runStartFields = (
  start: RunStart
): { runMode: RunMode; questId?: string; ghostClaimId?: string } =>
  start.mode === 'quest'
    ? { runMode: 'quest', questId: start.questId }
    : start.mode === 'ghost'
      ? { runMode: 'ghost', ghostClaimId: start.ghostClaimId }
      : { runMode: start.mode };

/**
 * Rebuild a start from stored columns. Anything that doesn't add up is treated
 * as no mode, not guessed at: a row the recorder didn't write consistently is
 * safer uploaded as a pre-mode run than as the wrong mode.
 */
export const runStartFromColumns = (
  mode: unknown,
  questId: unknown,
  ghostClaimId: unknown
): RunStart | undefined => {
  if (mode === 'free' || mode === 'turf') return { mode };
  if (mode === 'quest' && typeof questId === 'string' && questId) return { mode, questId };
  if (mode === 'ghost' && typeof ghostClaimId === 'string' && ghostClaimId)
    return { mode, ghostClaimId };
  return undefined;
};

/**
 * The mode to save a run as when the server refuses the one it started with.
 *
 * The server checks the mode when the run is created, and the app creates it
 * when the run uploads, which on an offline-first phone can be hours later. By
 * then the rival may have lost the ground, or the quest may be closed. A
 * refusal then would repeat on every retry and the run would never save, so
 * the run is kept in the nearest mode the server still accepts:
 *
 * - A Ghost Race becomes a Turf run. The runner still ran the loop, and Turf
 *   carves ground exactly as a Ghost Race does.
 * - A Quest run becomes a Free run. It can't complete a quest it no longer
 *   holds, and it was never meant to claim ground.
 *
 * Free and Turf take nothing the server can refuse, so they have no fallback.
 */
export const runStartFallback = (
  start: RunStart
): { start: RunStart; refused: 'quest' | 'ghost' } | undefined =>
  start.mode === 'ghost'
    ? { start: TURF_RUN, refused: 'ghost' }
    : start.mode === 'quest'
      ? { start: FREE_RUN, refused: 'quest' }
      : undefined;
