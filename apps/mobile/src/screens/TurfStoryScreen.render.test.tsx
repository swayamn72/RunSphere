import React from 'react';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', async () => {
  const React = await import('react');
  const native =
    (name: string) =>
    ({ children, ...props }: Record<string, unknown>) =>
      React.createElement(name as React.ElementType, props, children as React.ReactNode);
  return {
    BackHandler: { addEventListener: () => ({ remove: () => undefined }) },
    Pressable: native('Pressable'),
    StyleSheet: { create: <T,>(styles: T) => styles, absoluteFill: {} },
    Text: native('Text'),
    View: native('View')
  };
});
vi.mock('@maplibre/maplibre-react-native', async () => {
  const React = await import('react');
  const native =
    (name: string) =>
    ({ children, ...props }: Record<string, unknown>) =>
      React.createElement(name as React.ElementType, props, children as React.ReactNode);
  return {
    Camera: React.forwardRef(() => null),
    GeoJSONSource: native('GeoJSONSource'),
    Layer: native('Layer'),
    Map: native('Map'),
    Marker: native('Marker')
  };
});
vi.mock('../theme/theme', async () => (await import('../theme/theme-mock.js')).themeMock('light'));
vi.mock('../components/primitives', async () => {
  const React = await import('react');
  return {
    PrimaryButton: ({ label, onPress }: { label: string; onPress: () => void }) =>
      React.createElement('Pressable', { accessibilityLabel: label, onPress })
  };
});
vi.mock('../maps/map-config', () => ({
  resolveMapRenderPlan: () => ({
    kind: 'provider',
    provider: { styleUrl: 'https://tiles.example.com/style.json', attribution: 'Example' }
  })
}));
/** The style is already in hand, so the map draws at once. */
vi.mock('../maps/turf-world-style-cache', () => ({
  cachedTurfWorldStyle: () => ({ version: 8, sources: {}, layers: [] }),
  hasTurfWorldStyle: () => true,
  loadTurfWorldStyle: async () => undefined
}));

const { TurfStoryScreen } = await import('./TurfStoryScreen.js');
const { STORY_AREAS, STORY_SCENES, formatArea } = await import('./turf-story-model.js');

const textOf = (renderer: ReactTestRenderer) =>
  renderer.root
    .findAllByType('Text' as unknown as React.ElementType)
    .flatMap((node) => node.children.filter((child): child is string => typeof child === 'string'))
    .join(' | ');

const press = async (renderer: ReactTestRenderer, label: string) => {
  const node = renderer.root.find(
    (candidate) => (candidate.props as { accessibilityLabel?: string }).accessibilityLabel === label
  );
  await act(async () => (node.props as { onPress: () => void }).onPress());
};

const render = async (props: { onStartRun?: () => void } = {}) => {
  const onDone = vi.fn();
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<TurfStoryScreen onDone={onDone} {...props} />);
  });
  return { renderer, onDone };
};

describe('How Turf works story', () => {
  it('opens on the first scene and walks forward and back', async () => {
    const { renderer } = await render();
    expect(textOf(renderer)).toContain(STORY_SCENES[0]!.title);
    await press(renderer, 'Next');
    expect(textOf(renderer)).toContain(STORY_SCENES[1]!.title);
    await press(renderer, 'Back');
    expect(textOf(renderer)).toContain(STORY_SCENES[0]!.title);
  });

  it('closes from the first scene and on Skip', async () => {
    const first = await render();
    await press(first.renderer, 'Close');
    expect(first.onDone).toHaveBeenCalledTimes(1);
    const second = await render();
    await press(second.renderer, 'Next');
    await press(second.renderer, 'Skip');
    expect(second.onDone).toHaveBeenCalledTimes(1);
  });

  it('shows each scene finished under reduce motion, with the real area', async () => {
    // The theme mock has reduce motion on.
    const { renderer } = await render();
    await press(renderer, 'Next');
    expect(textOf(renderer)).toContain(`${formatArea(STORY_AREAS.yours)} m²`);
    await press(renderer, 'Next');
    expect(textOf(renderer)).toContain(`${formatArea(STORY_AREAS.taken)} m²`);
    expect(textOf(renderer)).toContain('TAKEN');
  });

  it('ends on a run when it can start one, and on Done when it cannot', async () => {
    const onStartRun = vi.fn();
    const withRun = await render({ onStartRun });
    for (let step = 1; step < STORY_SCENES.length; step += 1) await press(withRun.renderer, 'Next');
    await press(withRun.renderer, 'Start a run');
    expect(onStartRun).toHaveBeenCalledTimes(1);
    expect(withRun.onDone).not.toHaveBeenCalled();

    const plain = await render();
    for (let step = 1; step < STORY_SCENES.length; step += 1) await press(plain.renderer, 'Next');
    await press(plain.renderer, 'Done');
    expect(plain.onDone).toHaveBeenCalledTimes(1);
  });

  it('draws the made-up ground, never a real claim', async () => {
    const { renderer } = await render();
    const sources = renderer.root
      .findAllByType('GeoJSONSource' as unknown as React.ElementType)
      .map((node) => (node.props as { id: string }).id);
    expect(sources.every((id) => id.startsWith('story-'))).toBe(true);
  });
});
