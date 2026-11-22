import { describe, expect, it } from 'vitest';
import {
  BUBBLE_GAP,
  RING_PAD,
  bubbleSide,
  bubbleTop,
  panelsAround,
  ringRect
} from './tutorial-overlay-model.js';

const screen = { x: 0, y: 0, width: 400, height: 800 };

describe('tour overlay geometry (M9 9.23)', () => {
  it('grows the ring around the button and keeps it on screen', () => {
    expect(ringRect({ x: 100, y: 700, width: 60, height: 40 }, screen)).toEqual({
      x: 100 - RING_PAD,
      y: 700 - RING_PAD,
      width: 60 + RING_PAD * 2,
      height: 40 + RING_PAD * 2
    });
    expect(ringRect({ x: 0, y: 770, width: 400, height: 40 }, screen)).toEqual({
      x: 0,
      y: 764,
      width: 400,
      height: 36
    });
  });

  it('covers everything but the hole with four panels', () => {
    const hole = { x: 100, y: 300, width: 100, height: 50 };
    const panels = panelsAround(hole, screen);
    expect(panels).toHaveLength(4);
    const area = panels.reduce((sum, panel) => sum + panel.width * panel.height, 0);
    expect(area).toBe(400 * 800 - 100 * 50);
    // A hole on the edge needs fewer panels.
    expect(panelsAround({ x: 0, y: 0, width: 400, height: 50 }, screen)).toHaveLength(1);
  });

  it('puts the bubble on the step’s side when it fits, else where there is room', () => {
    const nearBottom = { x: 100, y: 720, width: 80, height: 60 };
    expect(bubbleSide(nearBottom, screen, 180, 'below')).toBe('above');
    expect(bubbleSide(nearBottom, screen, 180, 'above')).toBe('above');
    const nearTop = { x: 100, y: 40, width: 80, height: 60 };
    expect(bubbleSide(nearTop, screen, 180, 'above')).toBe('below');
    expect(bubbleTop(nearBottom, screen, 180, 'above')).toBe(720 - BUBBLE_GAP - 180);
    expect(bubbleTop(nearTop, screen, 180, 'below')).toBe(100 + BUBBLE_GAP);
    // Never off screen, even when neither side fits.
    expect(bubbleTop({ x: 0, y: 0, width: 400, height: 790 }, screen, 180, 'below')).toBe(
      800 - 180 - BUBBLE_GAP
    );
  });
});
