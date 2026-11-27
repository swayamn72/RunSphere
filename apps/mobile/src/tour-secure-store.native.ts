import * as SecureStore from 'expo-secure-store';
import { createTourStore } from './tutorial-model';
import { createTurfStoryStore } from './screens/turf-story-model';

/** Per account on this device: which tour version was finished. Nothing else. */
export const persistentTourStore = createTourStore(SecureStore);

/** Per account on this device: which How Turf works story version was seen. */
export const persistentTurfStoryStore = createTurfStoryStore(SecureStore);
