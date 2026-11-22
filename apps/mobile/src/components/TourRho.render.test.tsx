import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TOUR_STEPS } from '../tutorial-model.js';
import { isRhoTone } from '../rho-coach.js';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../theme/theme', () => ({
  useAppTheme: () => ({ tokens: { mascot: { body: 'b', outline: 'o', eye: 'e', beacon: 'n' } } })
}));

const { TourRho, useTypedLine, TYPE_RATE } = await import('./TourRho.js');

function Typed({ line, reduceMotion }: { line: string; reduceMotion: boolean }) {
  return React.createElement('Line' as React.ElementType, {
    text: useTypedLine(line, reduceMotion)
  });
}

afterEach(() => vi.useRealTimers());

describe('animated Rho for the tour (M9 9.24)', () => {
  it('draws Rho from its own geometry, hidden from screen readers', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<TourRho gesture="wave" reduceMotion={false} />);
    });
    const root = renderer.root.findAll((node) => (node.type as unknown) === 'Animated.View')[0]!;
    expect(root.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(renderer.root.findAll((node) => (node.type as unknown) === 'Ellipse')).toHaveLength(3);
  });

  it('types the line on, or shows it whole with reduce motion', async () => {
    vi.useFakeTimers();
    const line = TOUR_STEPS[0]!.rhoLine;
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<Typed line={line} reduceMotion={false} />);
    });
    const text = () => renderer.root.findByType('Line' as React.ElementType).props.text as string;
    expect(text()).toBe('');
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(text().length).toBeGreaterThan(0);
    expect(line.startsWith(text())).toBe(true);
    await act(async () => {
      vi.advanceTimersByTime((line.length / TYPE_RATE) * 1_000 + 100);
    });
    expect(text()).toBe(line);

    await act(async () => {
      renderer.update(<Typed line="Whole at once." reduceMotion />);
    });
    expect(text()).toBe('Whole at once.');
  });

  it('only ever says lines that pass Rho’s tone test', () => {
    expect(TOUR_STEPS.every((step) => isRhoTone(step.rhoLine))).toBe(true);
  });
});
