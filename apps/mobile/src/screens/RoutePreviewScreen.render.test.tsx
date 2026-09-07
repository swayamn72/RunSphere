import React from 'react';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RouteSuggestion, RouteSuggestionResponse } from '@runsphere/contracts';
import type { MobileApiClient } from '../api-client';
import type { ForegroundLocationPermission } from '../location-permission';
import type { RouteGuide } from './route-preview-model';

vi.mock('react-native', async () => {
  const React = await import('react');
  const native =
    (name: string) =>
    ({ children, ...props }: Record<string, unknown>) =>
      React.createElement(name as React.ElementType, props, children as React.ReactNode);
  return {
    Pressable: native('Pressable'),
    ScrollView: native('ScrollView'),
    StyleSheet: { create: <T,>(styles: T) => styles },
    Text: native('Text'),
    TextInput: native('TextInput'),
    View: native('View')
  };
});

const currentPosition = vi.fn((_options: { accuracy: number }) =>
  Promise.resolve({ coords: { latitude: 19.028, longitude: 72.838 } })
);
const foreground = vi.fn(() =>
  Promise.resolve<ForegroundLocationPermission>({
    status: 'granted',
    granted: true,
    canAskAgain: true
  })
);

vi.mock('expo-location', () => ({
  Accuracy: { Lowest: 1, Low: 2, Balanced: 3, High: 4, Highest: 5 },
  getForegroundPermissionsAsync: () => foreground(),
  requestForegroundPermissionsAsync: () => foreground(),
  getCurrentPositionAsync: (options: { accuracy: number }) => currentPosition(options)
}));

vi.mock('../maps/MapSurface', () => ({ MapSurface: () => null }));
vi.mock('../components/primitives', async () => {
  const React = await import('react');
  return {
    BackHeader: () => null,
    // Kept pressable so the screen's two commitments can actually be pressed.
    PrimaryButton: ({ label, onPress }: { label: string; onPress: () => void }) =>
      React.createElement('Pressable', { accessibilityLabel: label, onPress })
  };
});
vi.mock('../components/styles', () => ({
  useAppStyles: () =>
    new Proxy({}, { get: (_target, key) => ({ testStyle: String(key) }) }) as Record<
      string,
      unknown
    >
}));

const { RoutePreviewScreen } = await import('./RoutePreviewScreen.js');

const loop = (overrides: Partial<RouteSuggestion> = {}): RouteSuggestion => ({
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Shivaji Park Loop',
  path: [
    [72.838, 19.028],
    [72.842, 19.028],
    [72.842, 19.032],
    [72.838, 19.028]
  ],
  start: [72.838, 19.028],
  distanceMetres: 3_000,
  startDistanceMetres: 240,
  estimatedSeconds: 1_080,
  surface: 'paved',
  lit: true,
  trafficExposure: 'low',
  accessibility: 'step-free',
  reason: 'Close to you',
  ...overrides
});

const suggestRoutes = vi.fn(
  (_position: { latitude: number; longitude: number }, _options: Record<string, number>) =>
    Promise.resolve(undefined as unknown as RouteSuggestionResponse)
);
const sendFeedback = vi.fn((_routeId: string, _action: string) => Promise.resolve(true));

const api = (): MobileApiClient =>
  ({
    suggestRoutes: (
      position: { latitude: number; longitude: number },
      options: Record<string, number>
    ) => suggestRoutes(position, options),
    sendRouteSuggestionFeedback: (routeId: string, action: string) => sendFeedback(routeId, action)
  }) as unknown as MobileApiClient;

const answer = (overrides: Partial<RouteSuggestionResponse> = {}): RouteSuggestionResponse => ({
  data: [
    loop({ id: '11111111-1111-4111-8111-111111111111', distanceMetres: 2_000 }),
    loop({ id: '22222222-2222-4222-8222-222222222222', distanceMetres: 4_000 }),
    loop({ id: '33333333-3333-4333-8333-333333333333', distanceMetres: 6_000 })
  ],
  targetDistanceMetres: 4_000,
  targetReason: 'your_usual_distance',
  note: 'A guide, not a course.',
  ...overrides
});

const used: RouteGuide[] = [];
let startedWithout = 0;

const render = async (): Promise<ReactTestRenderer> => {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <RoutePreviewScreen
        api={api()}
        onUseRoute={(guide) => used.push(guide)}
        onStartWithout={() => {
          startedWithout += 1;
        }}
        onBack={() => undefined}
        onSessionExpired={() => undefined}
      />
    );
  });
  return renderer;
};

const texts = (renderer: ReactTestRenderer): string[] =>
  renderer.root
    .findAllByType('Text' as never)
    .flatMap((node) => (Array.isArray(node.props.children) ? [] : [String(node.props.children)]));

const press = async (renderer: ReactTestRenderer, label: string): Promise<void> => {
  const target = renderer.root
    .findAllByType('Pressable' as never)
    .find((node) => String(node.props.accessibilityLabel ?? '').startsWith(label));
  if (!target) throw new Error(`No pressable starting with "${label}"`);
  await act(async () => {
    (target.props.onPress as () => void)();
  });
};

beforeEach(() => {
  suggestRoutes.mockReset();
  suggestRoutes.mockResolvedValue(answer());
  sendFeedback.mockClear();
  currentPosition.mockClear();
  used.length = 0;
  startedWithout = 0;
});

describe('the route preview screen', () => {
  it('asks the device for a coarse fix, never a precise one', async () => {
    // The endpoint takes a coarse position and stores none of it
    // (`RouteSuggestionQuerySchema`). Requesting `Highest` here would collect
    // a precise location for something that does not use one.
    await render();

    expect(currentPosition).toHaveBeenCalledWith({ accuracy: 2 });
  });

  it('shows the three loops with size words and their distances', async () => {
    const renderer = await render();
    const shown = texts(renderer);

    expect(shown).toContain('Short');
    expect(shown).toContain('Medium');
    expect(shown).toContain('Long');
    expect(shown).toContain('2 km');
    expect(shown).toContain('6 km');
  });

  it('says why this distance, and repeats the note about it being a guide', async () => {
    const renderer = await render();
    const shown = texts(renderer);

    expect(shown.some((text) => text.includes('close to your usual'))).toBe(true);
    expect(shown).toContain('A guide, not a course.');
  });

  it('asks the server for a longer loop rather than scaling the one on screen', async () => {
    // `041_curated_routes.sql`: a scaled loop is one nobody reviewed.
    const renderer = await render();
    await press(renderer, 'Longer');

    expect(suggestRoutes).toHaveBeenCalledTimes(2);
    expect(suggestRoutes.mock.calls[1]?.[1]).toEqual({ targetDistanceKm: 4.5 });
  });

  it('records an acceptance and hands the run a guide, not the whole suggestion', async () => {
    const renderer = await render();
    await press(renderer, 'Use this route');

    expect(sendFeedback).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', 'accepted');
    expect(used).toHaveLength(1);
    expect(used[0]).toMatchObject({ routeId: '11111111-1111-4111-8111-111111111111' });
    expect(used[0]).not.toHaveProperty('estimatedSeconds');
  });

  it('still starts the run when the acceptance cannot be recorded', async () => {
    sendFeedback.mockRejectedValueOnce(new Error('offline'));
    const renderer = await render();

    await press(renderer, 'Use this route');

    expect(used).toHaveLength(1);
  });

  it('does not decline anything when the runner just wants to start', async () => {
    // A decline rests a loop for a month. Choosing no route today is not
    // rejecting the route, and treating it as one would quietly empty
    // somebody's suggestions.
    const renderer = await render();
    await press(renderer, 'Start without a route');

    expect(sendFeedback).not.toHaveBeenCalled();
    expect(startedWithout).toBe(1);
  });

  it('declines only the card the runner passed on, then asks again', async () => {
    const renderer = await render();
    await press(renderer, 'Not this one');

    expect(sendFeedback).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', 'declined');
    expect(suggestRoutes).toHaveBeenCalledTimes(2);
  });

  it('explains an empty answer without calling it an error', async () => {
    suggestRoutes.mockResolvedValue(
      answer({ data: [], unavailableReason: 'no_curated_routes', targetDistanceMetres: 4_000 })
    );

    const renderer = await render();
    const shown = texts(renderer);

    expect(shown.some((text) => text.includes('No reviewed routes near you yet'))).toBe(true);
    // And the run is still reachable from here.
    await press(renderer, 'Start without a route');
    expect(startedWithout).toBe(1);
  });

  it('offers a way on when the service cannot be reached', async () => {
    suggestRoutes.mockRejectedValue(new Error('down'));

    const renderer = await render();

    expect(texts(renderer).some((text) => text.includes('could not be loaded'))).toBe(true);
    await press(renderer, 'Start without a route');
    expect(startedWithout).toBe(1);
  });

  it('asks for location rather than failing when it was never granted', async () => {
    foreground.mockResolvedValueOnce({ status: 'denied', granted: false, canAskAgain: true });
    foreground.mockResolvedValueOnce({ status: 'denied', granted: false, canAskAgain: true });

    const renderer = await render();

    expect(texts(renderer).some((text) => text.includes('approximate location'))).toBe(true);
    expect(suggestRoutes).not.toHaveBeenCalled();
  });
});
