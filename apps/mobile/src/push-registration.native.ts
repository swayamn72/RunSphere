import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import {
  createPushRegistrationStore,
  type PushPermission,
  type PushTokenSource
} from './push-registration';

/** The provider token is a device credential, so it lives beside the auth tokens. */
export const pushRegistrationStore = createPushRegistrationStore(SecureStore);

/**
 * The platform half of push registration (ADR-0009, milestone 2.7).
 *
 * `push-registration.ts` was written with this seam left open and a comment
 * saying a native source "arrives with the FCM credentials the roadmap still
 * lists as a blocker". This is that source.
 *
 * **It asks for a device token, not for consent.** Whether any notification
 * actually wakes the device is decided server-side from the account's
 * categories, quiet hours, and daily cap, and nothing here can re-enable a
 * channel somebody switched off. The token is an address.
 *
 * The payload a push carries is the inbox id and a safe deep link, so the
 * handler below deliberately shows nothing by itself: the entry is read back
 * from the durable inbox, which is the delivery of record.
 */

/**
 * Nothing is shown from the payload, because the payload has nothing to show.
 *
 * A data-only FCM message has no title or body — that is the point (see
 * `push-delivery.ts`), so a foreground handler that tried to render one would
 * display a blank notification. The app refetches the inbox instead.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: false,
    shouldShowList: false,
    shouldPlaySound: false,
    shouldSetBadge: false
  })
});

/**
 * Android 13 and later require an explicit runtime grant for notifications.
 *
 * Asked for here rather than at first launch: `gameplay.md` requires the
 * Android notification permission to be requested *in context*, and the
 * context for this is having just signed in to an account that has an inbox.
 */
export const nativePushTokenSource: PushTokenSource = {
  async ensurePermission(): Promise<PushPermission> {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return 'granted';
    // `canAskAgain === false` means the OS will not show a prompt, so asking
    // would silently return denied and look like the user refused just now.
    if (!current.canAskAgain) return 'denied';
    const asked = await Notifications.requestPermissionsAsync();
    return asked.granted ? 'granted' : 'denied';
  },

  /**
   * The FCM registration token, not an Expo push token.
   *
   * `getDevicePushTokenAsync` returns the native provider address, which is
   * what `push-delivery.ts` sends to FCM HTTP v1 directly. An Expo push token
   * would route through Expo's service instead — another processor holding
   * every RunSphere device address, for no benefit, and one this product has
   * not disclosed (`safety-and-privacy.md`).
   */
  async currentToken(): Promise<string | undefined> {
    const token = await Notifications.getDevicePushTokenAsync();
    return typeof token.data === 'string' && token.data.length > 0 ? token.data : undefined;
  }
};
