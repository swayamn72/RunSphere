import * as SecureStore from 'expo-secure-store';
import { createTourStore } from './tutorial-model';

/** Per account on this device: which tour version was finished. Nothing else. */
export const persistentTourStore = createTourStore(SecureStore);
