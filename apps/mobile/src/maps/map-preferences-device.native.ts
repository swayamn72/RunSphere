import * as SecureStore from 'expo-secure-store';
import { loadMapPreferences } from './map-preferences';

/** Reads this device's map settings (3D buildings) once at startup. */
export const loadDeviceMapPreferences = (): Promise<void> => loadMapPreferences(SecureStore);
