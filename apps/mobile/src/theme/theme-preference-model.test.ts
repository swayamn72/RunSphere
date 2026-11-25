import { describe, expect, it } from 'vitest';
import { createThemePreferenceStore, type PreferenceStorage } from './theme-preference-model';

const fakeStorage = (
  initial?: string | null,
  failRead = false
): PreferenceStorage & {
  value: string | null;
} => {
  const box = {
    value: initial ?? null,
    getItemAsync: async () => {
      if (failRead) throw new Error('keychain unavailable');
      return box.value;
    },
    setItemAsync: async (_key: string, value: string) => {
      box.value = value;
    }
  };
  return box;
};

describe('theme preference store', () => {
  it('is light for a runner who has never chosen', async () => {
    expect(await createThemePreferenceStore(fakeStorage()).load()).toBe('light');
  });

  it('keeps what the runner chose', async () => {
    const storage = fakeStorage();
    const store = createThemePreferenceStore(storage);
    await store.save('dark');
    expect(await store.load()).toBe('dark');
    await store.save('system');
    expect(await createThemePreferenceStore(storage).load()).toBe('system');
  });

  it('falls back to light for an unknown value or an unreadable store', async () => {
    expect(await createThemePreferenceStore(fakeStorage('sepia')).load()).toBe('light');
    expect(await createThemePreferenceStore(fakeStorage('dark', true)).load()).toBe('light');
  });
});
