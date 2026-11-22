import type { RunLogItem } from '@runsphere/contracts';

/**
 * Opening a run from the log (M9 9.16–9.17).
 *
 * The detail opens as an overlay above the tabs, keeping the app's own
 * navigation (no navigation library mid-beta). It grows out of the card that
 * was tapped and shrinks back into it, so the model works in window
 * rectangles: where the card is, and the whole screen. `rectAt` and
 * `radiusAt` run on the UI thread inside Reanimated styles, hence 'worklet'.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What the host needs to open a run. */
export interface OpenRun {
  item: RunLogItem;
  /** Your own run: the detail can load its splits and offer Delete. */
  owner: boolean;
  /** The card's rectangle when tapped, if it could be measured. */
  origin?: Rect | undefined;
  /** Measures the card again when closing; it may have scrolled. */
  measureOrigin?: (() => Promise<Rect | undefined>) | undefined;
}

export const OPEN_DURATION_MS = 350;
/** Each section below the map fades in this much after the one above it. */
export const SECTION_STAGGER_MS = 40;
/** How far a section rises as it fades in. */
export const SECTION_RISE = 24;
export const CARD_RADIUS = 14;

/**
 * The spring that grows the card to full screen (`OPEN_DURATION_MS`): damping
 * ratio about 0.8, settling in about 0.31 s, clamped so the detail never
 * bulges past the screen edge.
 */
export const OPEN_SPRING = {
  damping: 26,
  stiffness: 260,
  mass: 1,
  overshootClamping: true
} as const;

/** Drag down at least this far, or flick this fast, and the detail closes. */
export const CLOSE_DRAG_DISTANCE = 96;
export const CLOSE_DRAG_VELOCITY = 0.9;

export const shouldCloseOnDrag = (dy: number, vy: number): boolean =>
  dy > CLOSE_DRAG_DISTANCE || (dy > 16 && vy > CLOSE_DRAG_VELOCITY);

/** Only a downward drag from near the top moves the detail; scrolling stays scrolling. */
export const startsCloseDrag = (dy: number, dx: number): boolean =>
  dy > 8 && Math.abs(dy) > Math.abs(dx) * 1.5;

/**
 * Where the detail starts and ends. Without a usable card rectangle (it
 * scrolled away, or couldn't be measured) the detail rises from, and falls
 * back to, just below the screen instead.
 */
export const transitionFrom = (origin: Rect | undefined, screen: Rect): Rect => {
  const usable =
    origin &&
    origin.width > 0 &&
    origin.height > 0 &&
    origin.y + origin.height > screen.y &&
    origin.y < screen.y + screen.height;
  return usable
    ? origin
    : { x: screen.x, y: screen.y + screen.height, width: screen.width, height: screen.height };
};

/** Interpolate a rectangle: 0 is the card, 1 is the screen. */
export const rectAt = (from: Rect, to: Rect, progress: number): Rect => {
  'worklet';
  return {
    x: from.x + (to.x - from.x) * progress,
    y: from.y + (to.y - from.y) * progress,
    width: from.width + (to.width - from.width) * progress,
    height: from.height + (to.height - from.height) * progress
  };
};

/** Corner radius from the card's to none at full screen. */
export const radiusAt = (progress: number): number => {
  'worklet';
  return CARD_RADIUS * (1 - progress);
};
