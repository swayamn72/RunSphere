import { isSafeMascotLabel } from './mascot';

/**
 * Rho as field coach (UX.8, `docs/voice.md` "Rho, the field coach").
 *
 * One cue per moment of a run: before, during and after. Cues talk about the
 * route and the loop, never about speed (ADR-0005), and never claim a result
 * the server has not confirmed: mid-run, "back at the start" is a fact the
 * phone can see; "claimed" is not, so Rho never says it. Copy lives here, not
 * in the screens, so the tone test covers every line Rho can say.
 */
export type RhoMoment =
  | { readonly moment: 'pre-run'; readonly holdsGround: boolean }
  | {
      readonly moment: 'mid-run';
      /** Metres from the start of the current loop, when a loop is forming. */
      readonly loopGapMetres?: number;
      readonly loopReady?: boolean;
      readonly gpsWeak?: boolean;
    }
  | { readonly moment: 'post-run'; readonly status: 'saved-offline' | 'checking' | 'counted' };

export interface RhoCue {
  readonly speaker: 'Rho';
  readonly message: string;
}

const cue = (message: string): RhoCue => ({ speaker: 'Rho', message });

/** Gaps are read mid-stride, so they're rounded to a number the eye takes in at once. */
const formatGap = (metres: number): string => {
  if (metres >= 1_000) return `${(metres / 1_000).toFixed(1)} km`;
  const rounded =
    metres < 100 ? Math.max(10, Math.round(metres / 10) * 10) : Math.round(metres / 50) * 50;
  return `${rounded} m`;
};

export const rhoCue = (state: RhoMoment): RhoCue | undefined => {
  switch (state.moment) {
    case 'pre-run':
      return state.holdsGround
        ? cue('Run your loop again to keep your ground.')
        : cue('Warm up 5 min, then loop the block once.');
    case 'mid-run':
      if (state.gpsWeak) return cue('GPS is patchy. Keep running; it catches up.');
      if (state.loopReady) return cue("You're back at the start. Stop here to close the loop.");
      if (state.loopGapMetres !== undefined && Number.isFinite(state.loopGapMetres))
        return cue(`Head back to the start · ${formatGap(state.loopGapMetres)}`);
      return undefined;
    case 'post-run':
      if (state.status === 'saved-offline')
        return cue("Run saved. It'll upload when you're back online.");
      if (state.status === 'checking') return cue('Run saved. Your totals show up in a moment.');
      return cue('Nice and steady. Same loop next time keeps the ground yours.');
  }
};

/** Phrases Rho must never use: pressure about pace or effort, or blame. */
export const RHO_BANNED =
  /\b(push harder|faster|too slow|slow down|lazy|you're behind|behind|beat them|failed|you missed|pathetic|weak effort)\b/i;

/** Every line Rho can say, for the tone test. */
export const allRhoLines = (): string[] => {
  const states: RhoMoment[] = [
    { moment: 'pre-run', holdsGround: true },
    { moment: 'pre-run', holdsGround: false },
    { moment: 'mid-run', gpsWeak: true },
    { moment: 'mid-run', loopReady: true },
    { moment: 'mid-run', loopGapMetres: 240 },
    { moment: 'post-run', status: 'saved-offline' },
    { moment: 'post-run', status: 'checking' },
    { moment: 'post-run', status: 'counted' }
  ];
  return states.flatMap((state) => {
    const line = rhoCue(state);
    return line ? [line.message] : [];
  });
};

export const isRhoTone = (message: string): boolean =>
  isSafeMascotLabel(message) && !RHO_BANNED.test(message);
