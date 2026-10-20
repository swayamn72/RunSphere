/**
 * Run verification: tying a recorded run to the person who owns the account.
 *
 * Territory, leaderboards, and challenges all pay out on running time, so the
 * question "was this the account holder running, or somebody holding their
 * phone?" has a prize attached to it. `run-integrity.ts` answers a different
 * question — whether the *trace* is physically possible — and a friend running
 * your phone produces a perfectly possible trace. This is the other half.
 *
 * **What the check actually is.** At the moment a run starts, the device asks
 * the operating system to confirm the person present: Face ID, fingerprint, or
 * the device passcode. The app never sees a face, a fingerprint, or a
 * passcode — the OS keeps all of that inside secure hardware and returns a
 * single boolean. Nothing biometric is stored, transmitted, or derivable from
 * anything recorded here.
 *
 * **What it is worth, honestly.** A pass means "somebody who can unlock this
 * phone was present when this run started". That is a real and useful claim,
 * and it is strictly weaker than three other things people will assume it
 * means:
 *
 *   1. It does not prove the account holder *ran*. They could unlock the phone
 *      and hand it over. It raises the cost of casual impersonation from zero
 *      to "ask the owner to unlock it for you", which is most of the benefit.
 *   2. It does not prove the phone is honest. A modified client can send
 *      `biometric` without ever prompting. Defeating that needs platform
 *      attestation (Play Integrity, DeviceCheck), which RunSphere does not use.
 *   3. It is not evidence a human can be sanctioned on by itself. Like every
 *      other integrity signal here, it informs review; it does not punish.
 *
 * Those limits are the reason the vocabulary below separates *trust* from
 * *outcome*, and the reason nothing in this file returns a verdict.
 *
 * Everything is a pure function over a recorded verification, so the policy can
 * be argued with by reading it.
 */

/**
 * How the person at the start of a run was confirmed.
 *
 * Only outcomes that can accompany a run that actually started appear here. A
 * failed or cancelled prompt does not produce a run at all — the client stops
 * before any route exists — so there is no `failed` member and nothing
 * downstream has to handle one.
 */
export type RunVerificationMethod =
  /**
   * The device had a face, fingerprint, or iris enrolled, and the person passed
   * the prompt it raised.
   *
   * Not quite "a fingerprint was read". Android's `BiometricPrompt` offers a
   * passcode fallback inside the same dialog and does not report which
   * authenticator the person actually used, so somebody who tapped "Use PIN"
   * lands here too. The honest reading is "passed the strongest check this
   * phone offered", which is what the distinction from `device-credential` is
   * worth and all it is worth.
   */
  | 'biometric'
  /**
   * The device had no biometric enrolled, so the prompt could only ask for the
   * PIN, pattern, or password — and the person passed it.
   */
  | 'device-credential'
  /**
   * The phone has no lock screen set up, so there was nothing to ask. The run
   * is allowed — a phone setting must not stop somebody recording their own
   * running — and is recorded as unverified so the difference stays visible.
   */
  | 'unenrolled'
  /** The device cannot authenticate at all (no hardware, OS too old, API absent). */
  | 'unsupported';

export const RUN_VERIFICATION_METHODS: readonly RunVerificationMethod[] = [
  'biometric',
  'device-credential',
  'unenrolled',
  'unsupported'
];

export const isRunVerificationMethod = (value: unknown): value is RunVerificationMethod =>
  typeof value === 'string' &&
  RUN_VERIFICATION_METHODS.includes(value as RunVerificationMethod);

/**
 * A verification as it travels with a run.
 *
 * `deviceId` is an opaque value the client generates once per installation. It
 * is not a hardware identifier, survives no reinstall, and cannot be joined to
 * anything outside RunSphere. It exists for one question review cannot answer
 * without it: whether many accounts are verifying from a single phone.
 */
export interface RunVerification {
  method: RunVerificationMethod;
  /** When the prompt was answered, ISO-8601. */
  verifiedAt: string;
  deviceId: string;
}

export type RunVerificationTrust = 'verified' | 'unverified';

/**
 * Whether a person was actually confirmed.
 *
 * Both unverified members are deliberately one bucket. "No lock screen" and
 * "no fingerprint reader" differ in cause and not in what they establish, and
 * a leaderboard that treated them differently would be sorting people by the
 * phone they can afford.
 */
export const runVerificationTrust = (method: RunVerificationMethod): RunVerificationTrust =>
  method === 'biometric' || method === 'device-credential' ? 'verified' : 'unverified';

/**
 * Plain copy for a results screen or a review queue. Says what happened, not
 * how good it is — and does not claim a fingerprint was read, because
 * `biometric` cannot promise that (see the member's own note).
 */
export const runVerificationLabel = (method: RunVerificationMethod): string => {
  if (method === 'biometric') return 'Confirmed with this phone’s screen lock';
  if (method === 'device-credential') return 'Confirmed with the device passcode';
  if (method === 'unenrolled') return 'Not confirmed: this phone has no screen lock';
  return 'Not confirmed: this phone cannot verify';
};

/**
 * How long before a run starts a verification may have been taken.
 *
 * The prompt is answered first and the run begins once GPS settles, which the
 * acquisition gate allows up to 30 seconds for. Five minutes leaves generous
 * room for a slow fix, a glance at a notification, or a cancelled-and-retried
 * GPS check, while still making a verification from an hour ago meaningless.
 */
export const RUN_VERIFICATION_MAX_AGE_SECONDS = 300;

/**
 * Tolerance for a verification stamped slightly *after* the run start.
 *
 * Phone clocks drift and the two timestamps are taken by different subsystems,
 * so a few seconds of apparent time travel is ordinary. Anything beyond it is
 * not a clock problem.
 */
export const RUN_VERIFICATION_MAX_SKEW_SECONDS = 60;

export type RunVerificationFreshness = 'fresh' | 'stale' | 'future' | 'unreadable';

/**
 * Whether a verification is close enough in time to the run it is attached to
 * for it to be about that run.
 *
 * This is the one claim a server can check without trusting the client's
 * honesty about anything but its own clock, which is why it is separated out
 * and named rather than folded into a boolean.
 */
export const runVerificationFreshness = (
  verifiedAt: string,
  startedAt: string
): RunVerificationFreshness => {
  const verified = Date.parse(verifiedAt);
  const started = Date.parse(startedAt);
  if (!Number.isFinite(verified) || !Number.isFinite(started)) return 'unreadable';
  const secondsBefore = (started - verified) / 1_000;
  if (secondsBefore < -RUN_VERIFICATION_MAX_SKEW_SECONDS) return 'future';
  if (secondsBefore > RUN_VERIFICATION_MAX_AGE_SECONDS) return 'stale';
  return 'fresh';
};

export type RunVerificationFinding =
  /** No verification arrived at all. Expected from app builds older than this feature. */
  | 'verification_absent'
  /** The device could not confirm anybody. Not the runner's fault; still not a confirmation. */
  | 'verification_unavailable'
  /** Taken too long before the run to be about it. */
  | 'verification_stale'
  /** Stamped after the run began by more than clock drift explains. */
  | 'verification_future_dated'
  /** Timestamps that do not parse. A client bug or a forged payload; review decides which. */
  | 'verification_unreadable';

export interface RunVerificationAssessment {
  trust: RunVerificationTrust;
  findings: readonly RunVerificationFinding[];
}

/**
 * What review should know about one run's verification.
 *
 * Absent and unavailable verifications are findings rather than failures: the
 * first is what every run recorded before this feature shipped looks like, and
 * the second is a phone without a lock screen. Both are reported so a reviewer
 * looking at a contested claim can see them; neither is grounds for anything on
 * its own.
 */
export const assessRunVerification = (
  verification: RunVerification | undefined,
  startedAt: string
): RunVerificationAssessment => {
  if (!verification) return { trust: 'unverified', findings: ['verification_absent'] };
  const trust = runVerificationTrust(verification.method);
  const findings: RunVerificationFinding[] = [];
  if (trust === 'unverified') findings.push('verification_unavailable');
  const freshness = runVerificationFreshness(verification.verifiedAt, startedAt);
  if (freshness === 'stale') findings.push('verification_stale');
  if (freshness === 'future') findings.push('verification_future_dated');
  if (freshness === 'unreadable') findings.push('verification_unreadable');
  // A verification that is not about this run does not verify this run, whatever
  // the prompt returned.
  return { trust: freshness === 'fresh' ? trust : 'unverified', findings };
};
