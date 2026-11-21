import type { LocationSample } from './activity-recorder-core';

/**
 * One location stream shared by every listener, started on the first listener
 * and stopped after the last (M8 C.3).
 *
 * Screen-off recording uses expo-location's `startLocationUpdatesAsync` with a
 * foreground service. Unlike `watchPositionAsync`, its samples don't arrive in
 * a callback: Android delivers them to a TaskManager task defined at module
 * scope (`App.tsx`), which calls `publish`. This joins the two ends and keeps
 * the native service's lifetime equal to "someone is recording".
 *
 * Start and stop are serialised on one chain, because the run screen
 * unsubscribes and resubscribes as its state changes: without it a stop could
 * land after the next start and leave a run with no service at all.
 */
export interface SharedLocationUpdates {
  subscribe(listener: (sample: LocationSample) => void): Promise<{ remove(): void }>;
  publish(samples: readonly LocationSample[]): void;
  readonly listenerCount: number;
}

export const createSharedLocationUpdates = (service: {
  start(): Promise<void>;
  stop(): Promise<void>;
}): SharedLocationUpdates => {
  const listeners = new Set<(sample: LocationSample) => void>();
  let running = false;
  let chain: Promise<void> = Promise.resolve();

  /** Bring the service in line with whether anyone is listening, one step at a time. */
  const reconcile = (): Promise<void> => {
    const step = chain.then(async () => {
      const wanted = listeners.size > 0;
      if (wanted && !running) {
        await service.start();
        running = true;
      } else if (!wanted && running) {
        running = false;
        await service.stop();
      }
    });
    // A failed step must not wedge every later one; the caller of this step
    // still sees the failure.
    chain = step.catch(() => undefined);
    return step;
  };

  return {
    async subscribe(listener) {
      listeners.add(listener);
      try {
        await reconcile();
      } catch (error) {
        listeners.delete(listener);
        throw error;
      }
      return {
        remove() {
          if (listeners.delete(listener)) void reconcile().catch(() => undefined);
        }
      };
    },
    publish(samples) {
      for (const sample of samples) for (const listener of [...listeners]) listener(sample);
    },
    get listenerCount() {
      return listeners.size;
    }
  };
};
