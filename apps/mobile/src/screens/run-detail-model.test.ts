import { describe, expect, it } from 'vitest';
import {
  CARD_RADIUS,
  radiusAt,
  rectAt,
  shouldCloseOnDrag,
  startsCloseDrag,
  transitionFrom
} from './run-detail-model.js';

const screen = { x: 0, y: 0, width: 400, height: 800 };

describe('run detail transitions (M9 9.16–9.17)', () => {
  it('grows from the card when it is on screen, else rises from below', () => {
    const card = { x: 16, y: 300, width: 368, height: 90 };
    expect(transitionFrom(card, screen)).toBe(card);
    expect(transitionFrom({ ...card, y: 900 }, screen)).toEqual({
      x: 0,
      y: 800,
      width: 400,
      height: 800
    });
    expect(transitionFrom(undefined, screen).y).toBe(800);
    expect(transitionFrom({ ...card, width: 0 }, screen).y).toBe(800);
  });

  it('interpolates the rectangle and corner radius', () => {
    const card = { x: 16, y: 300, width: 368, height: 90 };
    expect(rectAt(card, screen, 0)).toEqual(card);
    expect(rectAt(card, screen, 1)).toEqual(screen);
    expect(rectAt(card, screen, 0.5)).toEqual({ x: 8, y: 150, width: 384, height: 445 });
    expect(radiusAt(0)).toBe(CARD_RADIUS);
    expect(radiusAt(1)).toBe(0);
  });

  it('closes on a long pull down or a quick flick, not on a scroll or sideways swipe', () => {
    expect(shouldCloseOnDrag(120, 0.1)).toBe(true);
    expect(shouldCloseOnDrag(30, 1.4)).toBe(true);
    expect(shouldCloseOnDrag(30, 0.2)).toBe(false);
    expect(shouldCloseOnDrag(-200, 2)).toBe(false);
    expect(startsCloseDrag(20, 2)).toBe(true);
    expect(startsCloseDrag(20, 30)).toBe(false);
    expect(startsCloseDrag(-20, 0)).toBe(false);
  });
});
