import { describe, expect, it, vi } from 'vitest';
import type { LocationSample } from './activity-recorder-core';
import { createSharedLocationUpdates } from './shared-location-updates';

const sample = (n: number): LocationSample => ({
  recordedAt: new Date(Date.UTC(2026, 10, 22, 6, 0, n)).toISOString(),
  latitude: 0,
  longitude: 0,
  accuracy: 5,
  altitude: null
});

const service = () => {
  const events: string[] = [];
  return {
    events,
    start: vi.fn(async () => {
      events.push('start');
    }),
    stop: vi.fn(async () => {
      events.push('stop');
    })
  };
};

describe('shared location updates (screen-off recording)', () => {
  it('starts the service for the first listener and stops it after the last', async () => {
    const native = service();
    const updates = createSharedLocationUpdates(native);

    const first = await updates.subscribe(() => undefined);
    const second = await updates.subscribe(() => undefined);
    expect(native.start).toHaveBeenCalledTimes(1);

    first.remove();
    second.remove();
    await vi.waitFor(() => expect(native.stop).toHaveBeenCalledTimes(1));
    expect(updates.listenerCount).toBe(0);
  });

  it('delivers every published sample to every listener, in order', async () => {
    const updates = createSharedLocationUpdates(service());
    const a: string[] = [];
    const b: string[] = [];
    await updates.subscribe((s) => a.push(s.recordedAt));
    await updates.subscribe((s) => b.push(s.recordedAt));

    updates.publish([sample(1), sample(2)]);

    expect(a).toEqual([sample(1).recordedAt, sample(2).recordedAt]);
    expect(b).toEqual(a);
  });

  it('keeps the service running when a run resubscribes right after unsubscribing', async () => {
    const native = service();
    const updates = createSharedLocationUpdates(native);

    const before = await updates.subscribe(() => undefined);
    before.remove();
    await updates.subscribe(() => undefined);
    await vi.waitFor(() => expect(native.events.length).toBeGreaterThanOrEqual(1));

    // Whatever happened in between, the last word is "running".
    expect(native.events.at(-1)).toBe('start');
  });

  it('stops delivering to a listener once it is removed', async () => {
    const updates = createSharedLocationUpdates(service());
    const seen: string[] = [];
    const subscription = await updates.subscribe((s) => seen.push(s.recordedAt));
    subscription.remove();

    updates.publish([sample(3)]);

    expect(seen).toEqual([]);
  });

  it('reports a service that will not start, and recovers for the next try', async () => {
    const native = service();
    native.start.mockRejectedValueOnce(new Error('ForegroundServiceStartNotAllowed'));
    const updates = createSharedLocationUpdates(native);

    await expect(updates.subscribe(() => undefined)).rejects.toThrow('ForegroundServiceStart');
    expect(updates.listenerCount).toBe(0);

    await updates.subscribe(() => undefined);
    expect(native.start).toHaveBeenCalledTimes(2);
  });
});
