import {
  runVerificationTrust,
  type RunVerification,
  type RunVerificationMethod
} from '@runsphere/domain';
import type { SecureKeyValueStore } from './auth-storage-core';

/**
 * The gate that stands between tapping "Start recording" and a run existing.
 *
 * Why it is here at all: territory, leaderboards, and challenges pay out on
 * running time, so a phone handed to a faster friend is worth something. The
 * device is asked to confirm the person present before any route is created.
 * `@runsphere/domain`'s `run-verification.ts` carries the full statement of
 * what that does and does not prove — read it before trusting this.
 *
 * **Nothing biometric reaches this file.** The operating system raises its own
 * dialog, matches against its own enrolment inside secure hardware, and returns
 * a boolean. RunSphere never sees, stores, or transmits a face, a fingerprint,
 * or a passcode, and could not if it wanted to.
 *
 * **Order of operations: verify first, then GPS.** The acquisition gate is
 * allowed thirty seconds to find three clear fixes, and making somebody stand
 * in the cold for all thirty before telling them the prompt failed would be a
 * cruel way to arrange the same two checks. Verifying first also puts the
 * prompt where the tap was, which is where people expect it.
 *
 * Pure. Every transition is a function of the previous state and one device
 * answer, so the policy can be read rather than traced through a component.
 */

export type RunVerificationGateStatus =
  /** Nothing asked yet. */
  | 'idle'
  /** Asking the OS what it can do, before raising anything. */
  | 'checking'
  /** The OS dialog is up and somebody is looking at it. */
  | 'prompting'
  /** Confirmed. The run may start, and carries the verification. */
  | 'passed'
  /**
   * There was nothing to ask — no screen lock, or no hardware. The run may
   * start and is recorded as unverified.
   *
   * This is the deliberate policy choice in the whole file: a phone setting
   * must not stop somebody recording their own running. The cost is that
   * turning off the screen lock is a way around the gate, which is why the
   * difference is recorded and travels to the server rather than being
   * smoothed over.
   */
  | 'unavailable'
  /** The OS said no. No run starts. */
  | 'failed'
  /** The prompt was dismissed. No run starts, and this is not an error. */
  | 'cancelled';

export interface RunVerificationGate {
  readonly status: RunVerificationGateStatus;
  /** Present exactly when the status is `passed` or `unavailable`. */
  readonly verification?: RunVerification;
  /** Plain copy for the card. Present when there is something to explain. */
  readonly message?: string;
}

export const idleVerificationGate: RunVerificationGate = { status: 'idle' };

/** A run may begin from exactly these two states, and the gate is the only judge of that. */
export const mayStartRecording = (gate: RunVerificationGate): boolean =>
  gate.status === 'passed' || gate.status === 'unavailable';

/** Whether the person is mid-check, so the button should not invite a second tap. */
export const isVerificationBusy = (gate: RunVerificationGate): boolean =>
  gate.status === 'checking' || gate.status === 'prompting';

/**
 * What the device can do right now.
 *
 * Mirrors `expo-local-authentication`'s enrolled security level rather than its
 * list of supported sensor types: what matters is the strength of what is
 * actually set up, not what the hardware could do if somebody configured it.
 */
export type DeviceSecurityLevel =
  /** No screen lock at all. */
  | 'none'
  /** A PIN, pattern, or password, and no biometric. */
  | 'secret'
  /** A face, fingerprint, or iris is enrolled. */
  | 'biometric';

export interface DeviceAuthenticationCapability {
  hasHardware: boolean;
  securityLevel: DeviceSecurityLevel;
}

/**
 * Every way the OS can decline, normalised.
 *
 * `user-fallback` is absent deliberately: the prompt is always raised with the
 * device-credential fallback available, so "use my PIN instead" is handled
 * inside the OS dialog and comes back as an ordinary success.
 */
export type DeviceAuthenticationFailure =
  | 'cancelled'
  | 'not-enrolled'
  | 'not-available'
  | 'lockout'
  | 'rejected';

export type DeviceAuthenticationResult =
  | { readonly outcome: 'success' }
  | { readonly outcome: 'failure'; readonly reason: DeviceAuthenticationFailure };

const verificationOf = (
  method: RunVerificationMethod,
  nowIso: string,
  deviceId: string
): RunVerification => ({ method, verifiedAt: nowIso, deviceId });

const UNVERIFIED_NOTE =
  'This run will be saved as unverified. Set a screen lock to confirm your runs are yours.';

/** The person tapped start. Nothing has been asked yet. */
export const beginVerification = (): RunVerificationGate => ({ status: 'checking' });

/**
 * What the device reported it can do.
 *
 * Returns a settled `unavailable` when there is nothing to ask, so the caller
 * never raises a prompt it already knows will be refused — a dialog that
 * appears only to immediately error reads as a bug.
 */
export const applyDeviceCapability = (
  capability: DeviceAuthenticationCapability,
  nowIso: string,
  deviceId: string
): RunVerificationGate => {
  if (!capability.hasHardware)
    return {
      status: 'unavailable',
      verification: verificationOf('unsupported', nowIso, deviceId),
      message: `This phone cannot confirm who is running. ${UNVERIFIED_NOTE}`
    };
  if (capability.securityLevel === 'none')
    return {
      status: 'unavailable',
      verification: verificationOf('unenrolled', nowIso, deviceId),
      message: `This phone has no screen lock, so there is nothing to check. ${UNVERIFIED_NOTE}`
    };
  return { status: 'prompting' };
};

/**
 * How the prompt was answered.
 *
 * The recorded method comes from the enrolled level, not from the result: the
 * OS does not report which authenticator was tapped. The `biometric` member
 * documents that imprecision rather than papering over it.
 *
 * `lockout` is worth its own copy because it is the one failure somebody can
 * hit while being entirely honest — a wet finger three times running — and the
 * way out is the passcode the same dialog already offers.
 */
export const applyAuthenticationResult = (
  result: DeviceAuthenticationResult,
  capability: DeviceAuthenticationCapability,
  nowIso: string,
  deviceId: string
): RunVerificationGate => {
  if (result.outcome === 'success')
    return {
      status: 'passed',
      verification: verificationOf(
        capability.securityLevel === 'biometric' ? 'biometric' : 'device-credential',
        nowIso,
        deviceId
      )
    };
  if (result.reason === 'cancelled')
    return {
      status: 'cancelled',
      message: 'Verification was dismissed. No route or distance was created.'
    };
  // The device changed under us between the capability check and the prompt —
  // a screen lock removed in Settings, most likely. Treated as what it now is.
  if (result.reason === 'not-enrolled')
    return {
      status: 'unavailable',
      verification: verificationOf('unenrolled', nowIso, deviceId),
      message: `This phone has no screen lock, so there is nothing to check. ${UNVERIFIED_NOTE}`
    };
  if (result.reason === 'not-available')
    return {
      status: 'unavailable',
      verification: verificationOf('unsupported', nowIso, deviceId),
      message: `This phone cannot confirm who is running. ${UNVERIFIED_NOTE}`
    };
  if (result.reason === 'lockout')
    return {
      status: 'failed',
      message:
        'Too many failed attempts. Use your device passcode on the next try. No route or distance was created.'
    };
  return {
    status: 'failed',
    message: 'We could not confirm it is you. No route or distance was created. Try again.'
  };
};

/**
 * An unexpected throw from the authentication API.
 *
 * Deliberately a refusal rather than a pass-through to `unavailable`: a module
 * that threw told us nothing about the device, and treating "we do not know"
 * as "there was nothing to check" would turn every such bug into a silent hole
 * in the gate.
 */
export const verificationError = (): RunVerificationGate => ({
  status: 'failed',
  message: 'Verification could not run. No route or distance was created. Try again.'
});

/** The short line the preparation card shows under a settled gate. */
export const verificationStatusCopy = (gate: RunVerificationGate): string | undefined => {
  if (gate.status === 'checking') return 'Checking how this phone can confirm you…';
  if (gate.status === 'prompting') return 'Confirm it is you to start the run.';
  if (gate.status === 'passed') return 'Confirmed. Finding a clear GPS signal next.';
  return gate.message;
};

/**
 * Whether a settled gate is reporting good news.
 *
 * `unavailable` is a warning and `passed` is not, even though both let the run
 * start — which is the distinction the card's two notice styles exist to draw.
 */
export const isVerificationWarning = (gate: RunVerificationGate): boolean =>
  gate.status !== 'idle' &&
  gate.status !== 'checking' &&
  gate.status !== 'prompting' &&
  gate.status !== 'passed';

const deviceIdKey = 'runsphere.run-verification.device-id';

/**
 * The opaque per-installation id a verification carries.
 *
 * Generated once and kept in Keystore-backed SecureStore beside the auth
 * tokens. It is not a hardware identifier: a reinstall produces a new one, and
 * it joins to nothing outside RunSphere. It exists for the single question
 * review cannot ask without something stable to group by — whether many
 * accounts verify from one phone.
 *
 * Takes its generator as an argument so the tests can be deterministic and so
 * nothing here has to import a native crypto module.
 */
export const createVerificationDeviceStore = (
  store: SecureKeyValueStore,
  generateId: () => string
) => ({
  async deviceId(): Promise<string> {
    const existing = await store.getItemAsync(deviceIdKey);
    if (existing) return existing;
    const created = generateId();
    await store.setItemAsync(deviceIdKey, created);
    return created;
  }
});

/** Re-exported so a caller reading a gate does not need a second import to judge it. */
export { runVerificationTrust };
export type { RunVerification, RunVerificationMethod };
