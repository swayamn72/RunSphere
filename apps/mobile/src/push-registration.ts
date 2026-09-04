import type { SecureKeyValueStore } from './auth-storage-core';

/**
 * Client half of push delivery (ADR-0009, milestone 2.7).
 *
 * Registration is an address, not consent. Whether any notification actually
 * wakes the device is decided server-side from the account's categories, quiet
 * hours, and daily cap, so nothing here re-enables a channel the account
 * switched off, and nothing here decides what a push says: the payload carries
 * only the inbox id, and the entry is read back from the durable inbox.
 *
 * The provider token source is injected. A native source arrives with the FCM
 * credentials the roadmap still lists as a blocker; until then this module
 * reports `unavailable` and the app behaves exactly as it does today.
 */

export type PushPermission = 'granted' | 'denied' | 'unavailable';

/** The platform side: OS permission plus the current provider token. */
export interface PushTokenSource {
  ensurePermission(): Promise<PushPermission>;
  /** Undefined when the platform has no token to offer yet. */
  currentToken(): Promise<string | undefined>;
}

export interface PushRegistrationRecord {
  deviceId: string;
  token: string;
}

export interface PushRegistrationStore {
  read(): Promise<PushRegistrationRecord | undefined>;
  save(record: PushRegistrationRecord): Promise<void>;
  clear(): Promise<void>;
}

export interface PushRegistrationApi {
  registerPushDevice(token: string): Promise<{ id: string }>;
  revokePushDevice(deviceId: string): Promise<void>;
}

export interface PushRegistrationDependencies {
  api: PushRegistrationApi;
  source: PushTokenSource;
  store: PushRegistrationStore;
}

export type PushRegistrationOutcome =
  | 'registered'
  /** The stored token is still current, so no request was made. */
  | 'unchanged'
  | 'permission-denied'
  | 'unavailable'
  | 'failed';

const registrationKey = 'runsphere.push.registration';

/**
 * SecureStore-backed, because a provider token is a device credential: anything
 * holding it can address pushes at this installation.
 */
export const createPushRegistrationStore = (store: SecureKeyValueStore): PushRegistrationStore => ({
  async read() {
    const raw = await store.getItemAsync(registrationKey);
    if (!raw) return undefined;
    try {
      const parsed = JSON.parse(raw) as Partial<PushRegistrationRecord>;
      if (!parsed.deviceId || !parsed.token) return undefined;
      return { deviceId: parsed.deviceId, token: parsed.token };
    } catch {
      // A corrupt record re-registers rather than stranding the installation.
      return undefined;
    }
  },
  async save(record) {
    await store.setItemAsync(registrationKey, JSON.stringify(record));
  },
  async clear() {
    await store.deleteItemAsync(registrationKey);
  }
});

/**
 * Best-effort by design: push is an extra, and the durable inbox already
 * carries every notification. A failure here is reported, never thrown, so it
 * cannot block sign-in or the recording loop.
 */
export const registerForPush = async ({
  api,
  source,
  store
}: PushRegistrationDependencies): Promise<PushRegistrationOutcome> => {
  let permission: PushPermission;
  try {
    permission = await source.ensurePermission();
  } catch {
    return 'failed';
  }
  if (permission !== 'granted') {
    // A withdrawn permission must reach the server: otherwise it keeps sending
    // to an address the OS will never deliver to.
    await revokePushRegistration({ api, store });
    return permission === 'denied' ? 'permission-denied' : 'unavailable';
  }

  let token: string | undefined;
  try {
    token = await source.currentToken();
  } catch {
    return 'failed';
  }
  if (!token) return 'unavailable';

  const existing = await store.read();
  if (existing?.token === token) return 'unchanged';

  try {
    const device = await api.registerPushDevice(token);
    await store.save({ deviceId: device.id, token });
    return 'registered';
  } catch {
    // Keep any existing record: the previous address may still be live, and
    // dropping it locally would leak a registration nothing can revoke.
    return 'failed';
  }
};

/**
 * Revocation on sign-out, so a shared or handed-on device stops receiving one
 * account's wake-ups. The local record is cleared even when the call fails,
 * because a signed-out client can no longer authenticate the revoke.
 */
export const revokePushRegistration = async ({
  api,
  store
}: Pick<PushRegistrationDependencies, 'api' | 'store'>): Promise<void> => {
  const existing = await store.read();
  if (!existing) return;
  try {
    await api.revokePushDevice(existing.deviceId);
  } catch {
    // Best-effort: the server also revokes a token the provider rejects.
  }
  await store.clear();
};
