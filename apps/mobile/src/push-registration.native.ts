import * as SecureStore from 'expo-secure-store';
import { createPushRegistrationStore } from './push-registration';

/** The provider token is a device credential, so it lives beside the auth tokens. */
export const pushRegistrationStore = createPushRegistrationStore(SecureStore);
