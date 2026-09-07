import { beforeEach, describe, expect, it, vi } from 'vitest';

const notifications = vi.hoisted(() => ({
  getPermissionsAsync: vi.fn(),
  requestPermissionsAsync: vi.fn(),
  getDevicePushTokenAsync: vi.fn(),
  setNotificationHandler: vi.fn()
}));

vi.mock('expo-notifications', () => notifications);
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn()
}));

const { nativePushTokenSource } = await import('./push-registration.native');

/**
 * Captured at import time, because the module registers it on load and
 * `clearAllMocks` in `beforeEach` would otherwise erase the call.
 */
const registeredHandler = notifications.setNotificationHandler.mock.calls[0]?.[0] as
  { handleNotification: () => Promise<Record<string, boolean>> } | undefined;

/**
 * The platform half of push registration.
 *
 * `push-registration.ts` was written with this seam open and its own tests
 * cover the flow around it. What is checked here is the three things only this
 * file decides: which permission answer means what, that the token is the
 * native provider address rather than an Expo one, and that a push renders
 * nothing from its own payload.
 */
beforeEach(() => {
  vi.clearAllMocks();
});

describe('asking for notification permission', () => {
  it('does not re-prompt when it is already granted', async () => {
    notifications.getPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: false });

    expect(await nativePushTokenSource.ensurePermission()).toBe('granted');
    expect(notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('asks when it can, and reports what was answered', async () => {
    notifications.getPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true });
    notifications.requestPermissionsAsync.mockResolvedValue({ granted: true });

    expect(await nativePushTokenSource.ensurePermission()).toBe('granted');
    expect(notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('reports a refusal without asking again', async () => {
    notifications.getPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true });
    notifications.requestPermissionsAsync.mockResolvedValue({ granted: false });

    expect(await nativePushTokenSource.ensurePermission()).toBe('denied');
  });

  it('does not ask when the OS will not show a prompt', async () => {
    // Asking anyway returns denied without any dialog, which would look to the
    // caller like somebody had just refused — and `registerForPush` revokes the
    // server-side address on a refusal.
    notifications.getPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false });

    expect(await nativePushTokenSource.ensurePermission()).toBe('denied');
    expect(notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });
});

describe('the device token', () => {
  it('is the native provider address', async () => {
    notifications.getDevicePushTokenAsync.mockResolvedValue({ type: 'android', data: 'fcm-token' });

    expect(await nativePushTokenSource.currentToken()).toBe('fcm-token');
    // Not `getExpoPushTokenAsync`: an Expo token routes through Expo's service,
    // which would put another processor in front of every device address for no
    // benefit, and one this product has not disclosed.
    expect(notifications.getDevicePushTokenAsync).toHaveBeenCalled();
  });

  it('is absent rather than empty when the platform has none yet', async () => {
    notifications.getDevicePushTokenAsync.mockResolvedValue({ type: 'android', data: '' });

    expect(await nativePushTokenSource.currentToken()).toBeUndefined();
  });

  it('is absent when the platform returns something that is not a token', async () => {
    notifications.getDevicePushTokenAsync.mockResolvedValue({ type: 'android', data: undefined });

    expect(await nativePushTokenSource.currentToken()).toBeUndefined();
  });
});

describe('what a push displays by itself', () => {
  it('displays nothing', async () => {
    expect(registeredHandler).toBeDefined();
    const decision = await registeredHandler!.handleNotification();

    // A data-only message has no title or body — that is the point of the
    // server-side design — so a handler that tried to render one would show a
    // blank notification. The app refetches the durable inbox instead.
    expect(decision).toMatchObject({
      shouldShowBanner: false,
      shouldShowList: false,
      shouldPlaySound: false,
      shouldSetBadge: false
    });
  });
});
