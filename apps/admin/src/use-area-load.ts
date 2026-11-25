import { useEffect, useEffectEvent } from 'react';

/**
 * Loads an area's data once, when the area opens. Each area owns its own data
 * now, so leaving one drops it and opening it fetches fresh, which is what
 * `openArea` did before. A refresh button calls the same loader again.
 */
export function useAreaLoad(load: () => Promise<unknown> | void): void {
  const onOpen = useEffectEvent(load);
  useEffect(() => {
    void onOpen();
  }, []);
}
