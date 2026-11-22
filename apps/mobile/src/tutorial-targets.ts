import type { Rect } from './screens/run-detail-model';

/**
 * Where each tour target is on screen (M9 9.22). `TutorialTarget` reports its
 * window rectangle here whenever it may have moved; the overlay subscribes to
 * the step's target and draws the spotlight there.
 *
 * Re-measuring is asked for, not polled: on layout, when the window turns or
 * the keyboard opens or closes, when a scroll view settles, and when the tour
 * moves to a new step (`requestMeasure`).
 */

type Listener = (rect: Rect | undefined) => void;

export interface TargetRegistry {
  report(id: string, rect: Rect | undefined): void;
  remove(id: string): void;
  rect(id: string): Rect | undefined;
  subscribe(id: string, listener: Listener): () => void;
  /** Ask every mounted target to measure itself again. */
  requestMeasure(): void;
  onMeasureRequest(handler: () => void): () => void;
}

const sameRect = (a: Rect | undefined, b: Rect | undefined) =>
  a === b ||
  (a !== undefined &&
    b !== undefined &&
    Math.abs(a.x - b.x) < 0.5 &&
    Math.abs(a.y - b.y) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5);

export const createTargetRegistry = (): TargetRegistry => {
  const rects = new Map<string, Rect>();
  const listeners = new Map<string, Set<Listener>>();
  const measurers = new Set<() => void>();
  const notify = (id: string) => {
    for (const listener of listeners.get(id) ?? []) listener(rects.get(id));
  };
  return {
    report(id, rect) {
      const usable = rect && rect.width > 0 && rect.height > 0 ? rect : undefined;
      if (sameRect(rects.get(id), usable)) return;
      if (usable) rects.set(id, usable);
      else rects.delete(id);
      notify(id);
    },
    remove(id) {
      if (!rects.delete(id)) return;
      notify(id);
    },
    rect: (id) => rects.get(id),
    subscribe(id, listener) {
      const set = listeners.get(id) ?? new Set<Listener>();
      set.add(listener);
      listeners.set(id, set);
      return () => set.delete(listener);
    },
    requestMeasure() {
      for (const measure of [...measurers]) measure();
    },
    onMeasureRequest(handler) {
      measurers.add(handler);
      return () => measurers.delete(handler);
    }
  };
};

/** The app's one registry. */
export const tutorialTargets = createTargetRegistry();
