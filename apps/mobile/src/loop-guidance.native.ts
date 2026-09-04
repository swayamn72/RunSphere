import * as SecureStore from 'expo-secure-store';
import { createGuidanceStore } from './loop-guidance';

/** Per-installation guidance memory; carries no activity, location, or identity. */
export const persistentGuidanceStore = createGuidanceStore(SecureStore);
