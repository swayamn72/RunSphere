import { describe, expect, it } from 'vitest';
import { allRhoLines, isRhoTone, rhoCue } from './rho-coach';

describe('Rho field-coach cues (UX.8)', () => {
  it('has a cue for each moment of a run', () => {
    expect(rhoCue({ moment: 'pre-run', holdsGround: false })?.message).toMatch(/loop/);
    expect(rhoCue({ moment: 'pre-run', holdsGround: true })?.message).toMatch(/ground/);
    expect(rhoCue({ moment: 'mid-run', loopGapMetres: 238 })?.message).toBe(
      'Head back to the start · 250 m'
    );
    expect(rhoCue({ moment: 'mid-run', loopReady: true, loopGapMetres: 12 })?.message).toMatch(
      /back at the start/
    );
    expect(rhoCue({ moment: 'post-run', status: 'checking' })?.message).toMatch(/saved/i);
  });

  it('stays quiet mid-run when there is nothing useful to say', () => {
    expect(rhoCue({ moment: 'mid-run' })).toBeUndefined();
    expect(rhoCue({ moment: 'mid-run', loopGapMetres: Number.NaN })).toBeUndefined();
  });

  it('puts GPS trouble ahead of loop distance, since the distance is unreliable then', () => {
    expect(rhoCue({ moment: 'mid-run', gpsWeak: true, loopGapMetres: 80 })?.message).toMatch(/GPS/);
  });

  it('rounds short gaps to tens and longer ones to fifties, for a glance', () => {
    expect(rhoCue({ moment: 'mid-run', loopGapMetres: 3 })?.message).toMatch(/10 m$/);
    expect(rhoCue({ moment: 'mid-run', loopGapMetres: 74 })?.message).toMatch(/70 m$/);
    expect(rhoCue({ moment: 'mid-run', loopGapMetres: 1_020 })?.message).toMatch(/1.0 km$/);
  });

  it('never shames, pressures pace, or claims a result (tone test)', () => {
    const lines = allRhoLines();
    expect(lines.length).toBeGreaterThanOrEqual(8);
    for (const line of lines) expect(isRhoTone(line), line).toBe(true);
    expect(isRhoTone('Push harder, you are behind.')).toBe(false);
    expect(isRhoTone('Loop completed and claimed.')).toBe(false);
  });

  it('keeps mid-run cues short enough to read mid-stride', () => {
    for (const state of [
      { moment: 'mid-run', gpsWeak: true },
      { moment: 'mid-run', loopReady: true },
      { moment: 'mid-run', loopGapMetres: 1_500 }
    ] as const)
      expect(rhoCue(state)!.message.length).toBeLessThanOrEqual(56);
  });
});
