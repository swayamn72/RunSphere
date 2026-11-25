import * as SecureStore from 'expo-secure-store';
import { createThemePreferenceStore } from './theme-preference-model';

/** Light, Dark or Match phone, kept on this device. */
export const persistentThemePreferenceStore = createThemePreferenceStore(SecureStore);
