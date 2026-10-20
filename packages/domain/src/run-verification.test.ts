import { describe, expect, it } from 'vitest';
import {
  assessRunVerification,
  isRunVerificationMethod,
  RUN_VERIFICATION_MAX_AGE_SECONDS,
  RUN_VERIFICATION_MAX_SKEW_SECONDS,
  runVerificationFreshness,
  runVerificationLabel,
  runVerificationTrust,
  type RunVerification
} from './run-verification.js';

const startedAt = '2026-10-20T06:30:00.000Z';
const at = (secondsBeforeStart: number) =>
  new Date(Date.parse(startedAt) - secondsBeforeStart * 1_000).toISOString();
const verification = (overrides: Partial<RunVerification> = {}): RunVerification => ({
  method: 'biometric',
  verifiedAt: at(10),
  deviceId: 'device-1',
  ...overrides
});

describe('run verification trust', () => {
  it('counts a face, fingerprint, or passcode as a confirmed person', () => {
    expect(runVerificationTrust('biometric')).toBe('verified');
    expect(runVerificationTrust('device-credential')).toBe('verified');
  });

  it('does not distinguish a phone without a lock from one without the hardware', () => {
    expect(runVerificationTrust('unenrolled')).toBe('unverified');
    expect(runVerificationTrust('unsupported')).toBe('unverified');
  });

  it('names every method in copy that says what happened', () => {
    expect(runVerificationLabel('biometric')).toBe('Confirmed with this phone’s screen lock');
    expect(runVerificationLabel('device-credential')).toBe(
      'Confirmed with the device passcode'
    );
    expect(runVerificationLabel('unenrolled')).toContain('no screen lock');
    expect(runVerificationLabel('unsupported')).toContain('cannot verify');
  });

  it('recognises only the four methods a started run can carry', () => {
    expect(isRunVerificationMethod('biometric')).toBe(true);
    expect(isRunVerificationMethod('unsupported')).toBe(true);
    // A failed prompt never produces a run, so it is not a method.
    expect(isRunVerificationMethod('failed')).toBe(false);
    expect(isRunVerificationMethod(undefined)).toBe(false);
  });
});

describe('run verification freshness', () => {
  it('accepts a verification taken shortly before the run started', () => {
    expect(runVerificationFreshness(at(0), startedAt)).toBe('fresh');
    expect(runVerificationFreshness(at(RUN_VERIFICATION_MAX_AGE_SECONDS), startedAt)).toBe(
      'fresh'
    );
  });

  it('rejects one older than the window, which is no longer about this run', () => {
    expect(runVerificationFreshness(at(RUN_VERIFICATION_MAX_AGE_SECONDS + 1), startedAt)).toBe(
      'stale'
    );
  });

  it('tolerates ordinary clock drift after the start but not time travel', () => {
    expect(runVerificationFreshness(at(-RUN_VERIFICATION_MAX_SKEW_SECONDS), startedAt)).toBe(
      'fresh'
    );
    expect(runVerificationFreshness(at(-RUN_VERIFICATION_MAX_SKEW_SECONDS - 1), startedAt)).toBe(
      'future'
    );
  });

  it('reports timestamps it cannot parse rather than guessing', () => {
    expect(runVerificationFreshness('not-a-date', startedAt)).toBe('unreadable');
    expect(runVerificationFreshness(at(10), 'not-a-date')).toBe('unreadable');
  });
});

describe('assessing one run', () => {
  it('reports a fresh biometric pass as verified with nothing to review', () => {
    expect(assessRunVerification(verification(), startedAt)).toEqual({
      trust: 'verified',
      findings: []
    });
  });

  it('treats a run with no verification as unverified and says so', () => {
    expect(assessRunVerification(undefined, startedAt)).toEqual({
      trust: 'unverified',
      findings: ['verification_absent']
    });
  });

  it('flags a phone that could not confirm anybody without calling it a failure', () => {
    expect(assessRunVerification(verification({ method: 'unenrolled' }), startedAt)).toEqual({
      trust: 'unverified',
      findings: ['verification_unavailable']
    });
  });

  it('withdraws trust from a pass that is too old to be about this run', () => {
    const stale = verification({ verifiedAt: at(RUN_VERIFICATION_MAX_AGE_SECONDS + 60) });
    expect(assessRunVerification(stale, startedAt)).toEqual({
      trust: 'unverified',
      findings: ['verification_stale']
    });
  });

  it('withdraws trust from one stamped after the run began', () => {
    const future = verification({ verifiedAt: at(-RUN_VERIFICATION_MAX_SKEW_SECONDS - 10) });
    expect(assessRunVerification(future, startedAt)).toEqual({
      trust: 'unverified',
      findings: ['verification_future_dated']
    });
  });

  it('reports both an unavailable device and an unreadable timestamp together', () => {
    const broken = verification({ method: 'unsupported', verifiedAt: 'whenever' });
    expect(assessRunVerification(broken, startedAt)).toEqual({
      trust: 'unverified',
      findings: ['verification_unavailable', 'verification_unreadable']
    });
  });
});
