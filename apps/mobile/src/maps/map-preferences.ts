import { useSyncExternalStore } from 'react';
import type { PreferenceStorage } from '../theme/theme-preference-model';

const BUILDINGS_KEY = 'turfr.map-buildings-3d.v1';

/**
 * Map settings kept on this device (not per account, like the theme): today
 * only whether buildings stand up in 3D. On by default; a phone that struggles
 * can turn them off from the map's layers sheet.
 */
let buildings = true;
let storage: PreferenceStorage | undefined;
const listeners = new Set<() => void>();

const notify = () => listeners.forEach((listener) => listener());

/** Called once at startup with the device store; a bad read keeps the default. */
export async function loadMapPreferences(store: PreferenceStorage): Promise<void> {
  storage = store;
  try {
    const stored = await store.getItemAsync(BUILDINGS_KEY);
    if (stored === 'off' || stored === 'on') {
      buildings = stored === 'on';
      notify();
    }
  } catch {
    // Default stands.
  }
}

export const mapBuildingsOn = (): boolean => buildings;

export function setMapBuildings(on: boolean): void {
  if (on === buildings) return;
  buildings = on;
  notify();
  void storage?.setItemAsync(BUILDINGS_KEY, on ? 'on' : 'off').catch(() => undefined);
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useMapBuildings = (): boolean =>
  useSyncExternalStore(subscribe, mapBuildingsOn, mapBuildingsOn);

/** For tests only. */
export function resetMapPreferences(): void {
  buildings = true;
  storage = undefined;
  listeners.clear();
}
