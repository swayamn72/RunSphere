import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { randomUUID } from 'expo-crypto';
import {
  createVerificationDeviceStore,
  type DeviceAuthenticationCapability,
  type DeviceAuthenticationFailure,
  type DeviceAuthenticationResult,
  type DeviceSecurityLevel
} from './run-verification';

/**
 * The native half of the run verification gate.
 *
 * Everything that decides anything lives in `run-verification.ts`; this file
 * only translates `expo-local-authentication` into the small vocabulary that
 * module reasons about. Kept apart because the policy is worth testing and a
 * native module is not mockable into saying anything interesting.
 *
 * The app never receives biometric data through this seam and cannot: the OS
 * raises its own dialog, matches inside secure hardware, and hands back a
 * boolean plus, on refusal, a reason string.
 */

/**
 * `SecurityLevel` as a number rather than by name.
 *
 * The enum has been spelled `BIOMETRIC` and `BIOMETRIC_WEAK`/`BIOMETRIC_STRONG`
 * across versions of this module, and the ordering — none below secret below
 * any biometric — has been stable throughout. Comparing numerically survives
 * the next rename; naming members does not.
 */
const securityLevel = (level: number): DeviceSecurityLevel => {
  if (level >= 2) return 'biometric';
  return level === 1 ? 'secret' : 'none';
};

/**
 * The OS error strings, grouped by what the gate does about them.
 *
 * `user_fallback` sits with the cancellations rather than the refusals: it
 * means somebody asked for the passcode route. The prompt is always raised
 * with the device-credential fallback enabled, so on Android the OS handles
 * that inside its own dialog and never returns here; on a platform that does
 * return it, stopping without starting a run is the safe reading.
 */
const failureReasons: Readonly<Record<string, DeviceAuthenticationFailure>> = {
  user_cancel: 'cancelled',
  app_cancel: 'cancelled',
  system_cancel: 'cancelled',
  user_fallback: 'cancelled',
  not_enrolled: 'not-enrolled',
  passcode_not_set: 'not-enrolled',
  not_available: 'not-available',
  invalid_context: 'not-available',
  lockout: 'lockout',
  lockout_permanent: 'lockout'
};

export interface DeviceAuthenticator {
  capability(): Promise<DeviceAuthenticationCapability>;
  authenticate(): Promise<DeviceAuthenticationResult>;
}

export const deviceAuthenticator: DeviceAuthenticator = {
  async capability() {
    const [hasHardware, level] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.getEnrolledLevelAsync()
    ]);
    return { hasHardware, securityLevel: securityLevel(Number(level)) };
  },
  async authenticate() {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Confirm it is you before this run starts',
      cancelLabel: 'Not now',
      // The fallback stays on deliberately. It is what lets a wet finger, a
      // mask, or a biometric lockout resolve inside the same dialog instead of
      // stranding somebody who is standing outside ready to run.
      disableDeviceFallback: false,
      requireConfirmation: false
    });
    if (result.success) return { outcome: 'success' };
    // An unrecognised error is a refusal, never a pass. A new error string in
    // a future version of the module must not quietly open the gate.
    return { outcome: 'failure', reason: failureReasons[result.error] ?? 'rejected' };
  }
};

/** Keystore-backed, generated once per installation. See `createVerificationDeviceStore`. */
export const verificationDeviceStore = createVerificationDeviceStore(SecureStore, randomUUID);
