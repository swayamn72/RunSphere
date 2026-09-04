import { useCallback, useEffect, useRef, useState } from 'react';
import {
  guidanceStore,
  recordGuidanceDismissed,
  recordGuidanceShown,
  recordWeekSeen,
  selectGuidance,
  weeklyResetPending,
  type LoopGuidanceCue,
  type LoopGuidanceStore
} from '../loop-guidance';

export interface LoopGuidanceOptions {
  /** Server-reported week the surface is showing; enables the reset cue. */
  week?: string | undefined;
  store?: LoopGuidanceStore;
  now?: () => Date;
}

/**
 * Resolves at most one guidance cue for a surface and holds it steady for the
 * life of the mount. The frequency cap is charged once, when the cue is first
 * shown, rather than on every render: a cap that consumed itself on re-render
 * would make a cue flicker away mid-read.
 */
export const useLoopGuidance = (
  candidates: readonly LoopGuidanceCue[],
  { week, store = guidanceStore(), now = () => new Date() }: LoopGuidanceOptions = {}
): { cue: LoopGuidanceCue | undefined; dismiss: () => void } => {
  const [cue, setCue] = useState<LoopGuidanceCue>();
  const key = `${candidates.join(',')}|${week ?? ''}`;
  const resolvedKey = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (resolvedKey.current === key) return;
    let active = true;
    void (async () => {
      const memory = await store.read();
      if (!active) return;
      resolvedKey.current = key;
      // A reset is only news to a client that saw the previous week, so the
      // cue is dropped unless the stored week actually changed.
      const eligible = candidates.filter(
        (candidate) => candidate !== 'weekly-reset' || weeklyResetPending(memory, week)
      );
      const chosen = selectGuidance(eligible, memory, now());
      setCue(chosen);
      let next = week ? recordWeekSeen(memory, week) : memory;
      if (chosen) next = recordGuidanceShown(next, chosen, now());
      if (next !== memory) await store.save(next);
    })();
    return () => {
      active = false;
    };
  }, [key, candidates, week, store, now]);

  const dismiss = useCallback(() => {
    const dismissed = cue;
    if (!dismissed) return;
    setCue(undefined);
    void store
      .read()
      .then((memory) => store.save(recordGuidanceDismissed(memory, dismissed, now())));
  }, [cue, store, now]);

  return { cue, dismiss };
};
