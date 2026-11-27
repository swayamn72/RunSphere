import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./map-config', () => ({ resolveMapRenderPlan: () => ({ kind: 'fallback' }) }));

const { cachedTurfWorldStyle, hasTurfWorldStyle, loadTurfWorldStyle, resetTurfWorldStyleCache } =
  await import('./turf-world-style-cache');

const URL = 'https://tiles.example.com/style.json';
const NIGHT = { scheme: 'dark', buildings: true } as const;
const DAY = { scheme: 'light', buildings: true } as const;
const providerStyle = {
  version: 8,
  sources: {},
  layers: [
    { id: 'water', type: 'fill', source: 'v', 'source-layer': 'water', paint: {} },
    // The world style needs at least one road to be usable.
    { id: 'road_primary', type: 'line', source: 'v', 'source-layer': 'transportation', paint: {} }
  ]
};

const stubFetch = (respond: () => Promise<unknown>) => {
  const fetchMock = vi.fn(respond);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

afterEach(() => {
  resetTurfWorldStyleCache();
  vi.unstubAllGlobals();
});

describe('Turf world style cache', () => {
  it('fetches the style once, however many visits ask for it', async () => {
    const fetchMock = stubFetch(async () => ({ ok: true, json: async () => providerStyle }));
    const [first, second] = await Promise.all([
      loadTurfWorldStyle(URL, NIGHT),
      loadTurfWorldStyle(URL, NIGHT)
    ]);
    await loadTurfWorldStyle(URL, NIGHT);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
    expect(hasTurfWorldStyle(URL)).toBe(true);
    expect(cachedTurfWorldStyle(URL, NIGHT)?.layers[0]?.id).toBe('turf-night-background');
  });

  it('builds the day map from the same download', async () => {
    const fetchMock = stubFetch(async () => ({ ok: true, json: async () => providerStyle }));
    const night = await loadTurfWorldStyle(URL, NIGHT);
    const day = await loadTurfWorldStyle(URL, DAY);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(day).not.toBe(night);
    expect(cachedTurfWorldStyle(URL, DAY)).toBe(day);
  });

  it('tries again on the next visit after a failed request', async () => {
    const fetchMock = stubFetch(async () => {
      throw new Error('offline');
    });
    expect(await loadTurfWorldStyle(URL, NIGHT)).toBeUndefined();
    expect(hasTurfWorldStyle(URL)).toBe(false);
    await loadTurfWorldStyle(URL, NIGHT);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not remember a bad response', async () => {
    stubFetch(async () => ({ ok: false, json: async () => ({}) }));
    expect(await loadTurfWorldStyle(URL, NIGHT)).toBeUndefined();
    expect(hasTurfWorldStyle(URL)).toBe(false);
  });
});
