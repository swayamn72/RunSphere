import React from 'react';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { PrivacyZoneResponse } from '@runsphere/contracts';

vi.mock('react-native', async () => {
  const React = await import('react');
  const native =
    (name: string) =>
    ({ children, ...props }: Record<string, unknown>) =>
      React.createElement(name as React.ElementType, props, children as React.ReactNode);
  return { Pressable: native('Pressable'), Text: native('Text'), View: native('View') };
});
vi.mock('../components/styles', () => ({
  useAppStyles: () => new Proxy({}, { get: () => ({}) })
}));

const { PrivacyZoneList } = await import('./PrivacyZoneList.js');

const zone = (id: string, name: string): PrivacyZoneResponse => ({
  id,
  name,
  center: { latitude: 19.07, longitude: 72.88 },
  radiusMeters: 200,
  geometryVersion: 1
});

const texts = (renderer: ReactTestRenderer) =>
  renderer.root
    .findAll((node) => (node.type as unknown) === 'Text')
    .map((node) => {
      const children = node.props.children as unknown;
      return Array.isArray(children) ? children.join('') : String(children);
    });

const render = (zones: PrivacyZoneResponse[], onRemove = vi.fn()) => {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<PrivacyZoneList zones={zones} onRemove={onRemove} />);
  });
  return renderer;
};

describe('privacy zone list (M3.6)', () => {
  it('says so when there are no zones', () => {
    expect(texts(render([]))).toEqual(['No privacy zones yet.']);
  });

  it('lists each zone by name, never by its coordinates', () => {
    const shown = texts(render([zone('a', 'Home'), zone('b', 'Work')]));
    expect(shown).toContain('Home');
    expect(shown).toContain('Work');
    expect(shown.join(' ')).not.toMatch(/19\.07|72\.88/);
  });

  it('removes the zone that was tapped', () => {
    const onRemove = vi.fn();
    const renderer = render([zone('a', 'Home'), zone('b', 'Work')], onRemove);
    const remove = renderer.root.find(
      (node) => node.props.accessibilityLabel === 'Remove privacy zone Work'
    );
    act(() => {
      (remove.props.onPress as () => void)();
    });
    expect(onRemove).toHaveBeenCalledWith(expect.objectContaining({ id: 'b', name: 'Work' }));
  });
});
