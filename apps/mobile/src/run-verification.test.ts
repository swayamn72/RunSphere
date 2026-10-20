import { describe, expect, it } from 'vitest';
import {
  applyAuthenticationResult,
  applyDeviceCapability,
  beginVerification,
  createVerificationDeviceStore,
  idleVerificationGate,
  isVerificationBusy,
  isVerificationWarning,
  mayStartRecording,
  verificationError,
  verificationStatusCopy,
  type DeviceAuthenticationCapability
} from './run-verification.js';
import type { SecureKeyValueStore } from './auth-storage-core.js';

const now = '2026-10-21T06:30:00.000Z';
const deviceId = '7f1d0a9e-0000-4000-8000-000000000001';
const biometric: DeviceAuthenticationCapability = {
  hasHardware: true,
  securityLevel: 'biometric'
};
const passcodeOnly: DeviceAuthenticationCapability = {
  hasHardware: true,
  securityLevel: 'secret'
};
const noLock: DeviceAuthenticationCapability = { hasHardware: true, securityLevel: 'none' };
const noHardware: DeviceAuthenticationCapability = { hasHardware: false, securityLevel: 'none' };

describe('starting the gate', () => {
  it('asks what the device can do before raising anything', () => {
    expect(beginVerification()).toEqual({ status: 'checking' });
    expect(isVerificationBusy(beginVerification())).toBe(true);
  });

  it('refuses a run from the idle state', () => {
    expect(mayStartRecording(idleVerificationGate)).toBe(false);
  });
});

describe('what the device can do', () => {
  it('raises a prompt when there is a screen lock to ask about', () => {
    expect(applyDeviceCapability(biometric, now, deviceId)).toEqual({ status: 'prompting' });
    expect(applyDeviceCapability(passcodeOnly, now, deviceId)).toEqual({ status: 'prompting' });
  });

  it('does not raise a prompt it already knows will be refused', () => {
    const gate = applyDeviceCapability(noLock, now, deviceId);
    expect(gate.status).toBe('unavailable');
    expect(gate.verification).toEqual({ method: 'unenrolled', verifiedAt: now, deviceId });
  });

  it('separates a phone with no lock from one with no hardware', () => {
    expect(applyDeviceCapability(noHardware, now, deviceId).verification?.method).toBe(
      'unsupported'
    );
  });

  it('lets a run start unverified rather than stranding somebody over a phone setting', () => {
    const gate = applyDeviceCapability(noLock, now, deviceId);
    expect(mayStartRecording(gate)).toBe(true);
    expect(gate.message).toContain('saved as unverified');
  });
});

describe('answering the prompt', () => {
  it('records a pass on a biometric phone as the strongest check it offered', () => {
    const gate = applyAuthenticationResult({ outcome: 'success' }, biometric, now, deviceId);
    expect(gate.status).toBe('passed');
    expect(gate.verification).toEqual({ method: 'biometric', verifiedAt: now, deviceId });
    expect(mayStartRecording(gate)).toBe(true);
  });

  it('records a pass on a passcode-only phone as a device credential', () => {
    const gate = applyAuthenticationResult({ outcome: 'success' }, passcodeOnly, now, deviceId);
    expect(gate.verification?.method).toBe('device-credential');
  });

  it('stops the run when the prompt is dismissed, and does not call it an error', () => {
    const gate = applyAuthenticationResult(
      { outcome: 'failure', reason: 'cancelled' },
      biometric,
      now,
      deviceId
    );
    expect(gate.status).toBe('cancelled');
    expect(mayStartRecording(gate)).toBe(false);
    expect(gate.message).toContain('No route or distance was created');
  });

  it('stops the run when the device says no', () => {
    const gate = applyAuthenticationResult(
      { outcome: 'failure', reason: 'rejected' },
      biometric,
      now,
      deviceId
    );
    expect(gate.status).toBe('failed');
    expect(mayStartRecording(gate)).toBe(false);
  });

  it('points a locked-out runner at the passcode the same dialog offers', () => {
    const gate = applyAuthenticationResult(
      { outcome: 'failure', reason: 'lockout' },
      biometric,
      now,
      deviceId
    );
    expect(gate.status).toBe('failed');
    expect(gate.message).toContain('device passcode');
  });

  it('handles a screen lock removed between the check and the prompt', () => {
    const gate = applyAuthenticationResult(
      { outcome: 'failure', reason: 'not-enrolled' },
      biometric,
      now,
      deviceId
    );
    expect(gate.status).toBe('unavailable');
    expect(gate.verification?.method).toBe('unenrolled');
    expect(mayStartRecording(gate)).toBe(true);
  });

  it('reports a device that became unavailable as unsupported, not as a refusal', () => {
    const gate = applyAuthenticationResult(
      { outcome: 'failure', reason: 'not-available' },
      biometric,
      now,
      deviceId
    );
    expect(gate.verification?.method).toBe('unsupported');
  });

  it('refuses the run when the authentication module itself throws', () => {
    // "We do not know" must never become "there was nothing to check" — that
    // would turn any such bug into a silent hole in the gate.
    const gate = verificationError();
    expect(gate.status).toBe('failed');
    expect(mayStartRecording(gate)).toBe(false);
    expect(gate.verification).toBeUndefined();
  });
});

describe('what the card says', () => {
  it('narrates each busy step', () => {
    expect(verificationStatusCopy({ status: 'checking' })).toContain('Checking');
    expect(verificationStatusCopy({ status: 'prompting' })).toContain('Confirm it is you');
    expect(verificationStatusCopy({ status: 'passed' })).toContain('Confirmed');
  });

  it('treats a run allowed through unverified as a warning but a pass as not', () => {
    expect(isVerificationWarning(applyDeviceCapability(noLock, now, deviceId))).toBe(true);
    expect(
      isVerificationWarning(applyAuthenticationResult({ outcome: 'success' }, biometric, now, deviceId))
    ).toBe(false);
    expect(isVerificationWarning(idleVerificationGate)).toBe(false);
  });
});

class MemorySecureStore implements SecureKeyValueStore {
  private readonly values = new Map<string, string>();
  async getItemAsync(key: string) {
    return this.values.get(key) ?? null;
  }
  async setItemAsync(key: string, value: string) {
    this.values.set(key, value);
  }
  async deleteItemAsync(key: string) {
    this.values.delete(key);
  }
}

describe('the installation device id', () => {
  it('generates once and returns the same value afterwards', async () => {
    let generated = 0;
    const store = createVerificationDeviceStore(
      new MemorySecureStore(),
      () => `generated-${++generated}`
    );
    expect(await store.deviceId()).toBe('generated-1');
    expect(await store.deviceId()).toBe('generated-1');
    expect(generated).toBe(1);
  });

  it('starts fresh on a store that has been cleared, as a reinstall would', async () => {
    const secureStore = new MemorySecureStore();
    const store = createVerificationDeviceStore(secureStore, () => deviceId);
    await store.deviceId();
    await secureStore.deleteItemAsync('runsphere.run-verification.device-id');
    expect(await store.deviceId()).toBe(deviceId);
  });
});
