import { describe, expect, it, vi } from 'vitest';
import {
  createPushRegistrationStore,
  registerForPush,
  revokePushRegistration,
  type PushPermission,
  type PushRegistrationRecord,
  type PushRegistrationStore
} from './push-registration';

const memoryStore = (initial?: PushRegistrationRecord): PushRegistrationStore => {
  let record = initial;
  return {
    read: vi.fn(async () => record),
    save: vi.fn(async (next: PushRegistrationRecord) => {
      record = next;
    }),
    clear: vi.fn(async () => {
      record = undefined;
    })
  };
};

const source = (permission: PushPermission, token?: string) => ({
  ensurePermission: vi.fn(async () => permission),
  currentToken: vi.fn(async () => token)
});

const api = () => ({
  registerPushDevice: vi.fn(async () => ({ id: 'device-1' })),
  revokePushDevice: vi.fn(async () => undefined)
});

describe('registerForPush', () => {
  it('registers a new token and remembers the device it produced', async () => {
    const store = memoryStore();
    const client = api();

    await expect(
      registerForPush({ api: client, source: source('granted', 'token-1'), store })
    ).resolves.toBe('registered');

    expect(client.registerPushDevice).toHaveBeenCalledWith('token-1');
    expect(store.save).toHaveBeenCalledWith({ deviceId: 'device-1', token: 'token-1' });
  });

  it('makes no request when the stored token is still current', async () => {
    const store = memoryStore({ deviceId: 'device-1', token: 'token-1' });
    const client = api();

    await expect(
      registerForPush({ api: client, source: source('granted', 'token-1'), store })
    ).resolves.toBe('unchanged');

    expect(client.registerPushDevice).not.toHaveBeenCalled();
  });

  it('re-registers when the provider rotates the token', async () => {
    const store = memoryStore({ deviceId: 'device-1', token: 'token-1' });
    const client = api();
    client.registerPushDevice.mockResolvedValue({ id: 'device-2' });

    await expect(
      registerForPush({ api: client, source: source('granted', 'token-2'), store })
    ).resolves.toBe('registered');

    expect(store.save).toHaveBeenCalledWith({ deviceId: 'device-2', token: 'token-2' });
  });

  it('revokes the server side registration when permission is withdrawn', async () => {
    const store = memoryStore({ deviceId: 'device-1', token: 'token-1' });
    const client = api();

    await expect(registerForPush({ api: client, source: source('denied'), store })).resolves.toBe(
      'permission-denied'
    );

    expect(client.revokePushDevice).toHaveBeenCalledWith('device-1');
    expect(store.clear).toHaveBeenCalled();
  });

  it('reports an unavailable platform without registering anything', async () => {
    const store = memoryStore();
    const client = api();

    await expect(
      registerForPush({ api: client, source: source('unavailable'), store })
    ).resolves.toBe('unavailable');
    await expect(
      registerForPush({ api: client, source: source('granted', undefined), store })
    ).resolves.toBe('unavailable');

    expect(client.registerPushDevice).not.toHaveBeenCalled();
  });

  it('reports a failed registration without throwing or dropping the old record', async () => {
    const store = memoryStore({ deviceId: 'device-1', token: 'token-1' });
    const client = api();
    client.registerPushDevice.mockRejectedValue(new Error('offline'));

    await expect(
      registerForPush({ api: client, source: source('granted', 'token-2'), store })
    ).resolves.toBe('failed');

    expect(store.clear).not.toHaveBeenCalled();
    await expect(store.read()).resolves.toEqual({ deviceId: 'device-1', token: 'token-1' });
  });

  it('reports a failure when the platform cannot answer, rather than propagating it', async () => {
    const store = memoryStore();
    const client = api();
    const failing = {
      ensurePermission: vi.fn(async () => {
        throw new Error('no notification module');
      }),
      currentToken: vi.fn(async () => undefined)
    };

    await expect(registerForPush({ api: client, source: failing, store })).resolves.toBe('failed');
  });
});

describe('revokePushRegistration', () => {
  it('does nothing when this installation never registered', async () => {
    const store = memoryStore();
    const client = api();

    await revokePushRegistration({ api: client, store });

    expect(client.revokePushDevice).not.toHaveBeenCalled();
    expect(store.clear).not.toHaveBeenCalled();
  });

  it('clears the local record even when the revoke call fails', async () => {
    const store = memoryStore({ deviceId: 'device-1', token: 'token-1' });
    const client = api();
    client.revokePushDevice.mockRejectedValue(new Error('offline'));

    await revokePushRegistration({ api: client, store });

    expect(store.clear).toHaveBeenCalled();
  });
});

describe('createPushRegistrationStore', () => {
  const secureStore = (value: string | null) => ({
    getItemAsync: vi.fn(async () => value),
    setItemAsync: vi.fn(async () => undefined),
    deleteItemAsync: vi.fn(async () => undefined)
  });

  it('keeps the provider token in the secure store, not in plain app storage', async () => {
    const secure = secureStore(null);
    await createPushRegistrationStore(secure).save({ deviceId: 'device-1', token: 'token-1' });

    expect(secure.setItemAsync).toHaveBeenCalledWith(
      'runsphere.push.registration',
      JSON.stringify({ deviceId: 'device-1', token: 'token-1' })
    );
  });

  it('reads back a stored registration', async () => {
    const secure = secureStore(JSON.stringify({ deviceId: 'device-1', token: 'token-1' }));
    await expect(createPushRegistrationStore(secure).read()).resolves.toEqual({
      deviceId: 'device-1',
      token: 'token-1'
    });
  });

  it('treats a corrupt or partial record as unregistered rather than throwing', async () => {
    await expect(
      createPushRegistrationStore(secureStore('not json')).read()
    ).resolves.toBeUndefined();
    await expect(
      createPushRegistrationStore(secureStore(JSON.stringify({ deviceId: 'device-1' }))).read()
    ).resolves.toBeUndefined();
  });
});
