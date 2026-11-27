import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  loadMapPreferences,
  mapBuildingsOn,
  resetMapPreferences,
  setMapBuildings
} from './map-preferences';

const fakeStorage = (initial: Record<string, string> = {}) => {
  const values = { ...initial };
  return {
    values,
    getItemAsync: vi.fn(async (key: string) => values[key] ?? null),
    setItemAsync: vi.fn(async (key: string, value: string) => {
      values[key] = value;
    })
  };
};

afterEach(resetMapPreferences);

describe('map preferences (3D buildings)', () => {
  it('starts with buildings on', async () => {
    await loadMapPreferences(fakeStorage());
    expect(mapBuildingsOn()).toBe(true);
  });

  it('remembers turning them off on this device', async () => {
    const storage = fakeStorage();
    await loadMapPreferences(storage);
    setMapBuildings(false);
    expect(mapBuildingsOn()).toBe(false);
    expect(storage.values['turfr.map-buildings-3d.v1']).toBe('off');

    resetMapPreferences();
    await loadMapPreferences(storage);
    expect(mapBuildingsOn()).toBe(false);
  });

  it('keeps the default when the store is unreadable or holds junk', async () => {
    await loadMapPreferences(fakeStorage({ 'turfr.map-buildings-3d.v1': 'maybe' }));
    expect(mapBuildingsOn()).toBe(true);
    await loadMapPreferences({
      getItemAsync: async () => {
        throw new Error('locked');
      },
      setItemAsync: async () => undefined
    });
    expect(mapBuildingsOn()).toBe(true);
  });
});
