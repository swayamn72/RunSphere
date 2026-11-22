import type { Rect } from './screens/run-detail-model';
import type { TourPlacement } from './tutorial-model';

/**
 * Geometry for the tour overlay (M9 9.23). A blur can't have a hole cut in
 * it, so the screen around the spotlit button is covered by four blurred
 * panels (above, below, left, right of it), with the button itself left clear
 * inside a rounded ring.
 */

/** Space between the button and the ring. */
export const RING_PAD = 6;
export const RING_RADIUS = 16;
/** Room kept between the bubble and the ring, and the screen edge. */
export const BUBBLE_GAP = 12;

/** The spotlit area: the button grown by `RING_PAD`, kept on screen. */
export const ringRect = (target: Rect, screen: Rect): Rect => {
  const x = Math.max(screen.x, target.x - RING_PAD);
  const y = Math.max(screen.y, target.y - RING_PAD);
  const right = Math.min(screen.x + screen.width, target.x + target.width + RING_PAD);
  const bottom = Math.min(screen.y + screen.height, target.y + target.height + RING_PAD);
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
};

/** Four rectangles that together cover the screen except `hole`. */
export const panelsAround = (hole: Rect, screen: Rect): Rect[] => {
  const right = hole.x + hole.width;
  const bottom = hole.y + hole.height;
  return [
    { x: screen.x, y: screen.y, width: screen.width, height: hole.y - screen.y },
    { x: screen.x, y: bottom, width: screen.width, height: screen.y + screen.height - bottom },
    { x: screen.x, y: hole.y, width: hole.x - screen.x, height: hole.height },
    { x: right, y: hole.y, width: screen.x + screen.width - right, height: hole.height }
  ].filter((panel) => panel.width > 0 && panel.height > 0);
};

/**
 * Which side of the ring the bubble goes: the step's choice if it fits there,
 * else the side with more room.
 */
export const bubbleSide = (
  ring: Rect,
  screen: Rect,
  bubbleHeight: number,
  preferred: TourPlacement
): TourPlacement => {
  const above = ring.y - screen.y - BUBBLE_GAP;
  const below = screen.y + screen.height - (ring.y + ring.height) - BUBBLE_GAP;
  const fits = (side: TourPlacement) => (side === 'above' ? above : below) >= bubbleHeight;
  if (fits(preferred)) return preferred;
  const other: TourPlacement = preferred === 'above' ? 'below' : 'above';
  if (fits(other)) return other;
  return above >= below ? 'above' : 'below';
};

/** The bubble's top edge for that side, kept on screen. */
export const bubbleTop = (
  ring: Rect,
  screen: Rect,
  bubbleHeight: number,
  side: TourPlacement
): number => {
  const top =
    side === 'above' ? ring.y - BUBBLE_GAP - bubbleHeight : ring.y + ring.height + BUBBLE_GAP;
  return Math.min(
    Math.max(screen.y + BUBBLE_GAP, top),
    screen.y + screen.height - bubbleHeight - BUBBLE_GAP
  );
};
