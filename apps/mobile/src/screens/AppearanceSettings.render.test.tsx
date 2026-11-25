import React from 'react';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

const setPreference = vi.fn();
let preference: 'light' | 'dark' | 'system' = 'light';

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
vi.mock('../components/primitives', async () => {
  const React = await import('react');
  return {
    SettingsGroup: ({ title, children }: { title: string; children: React.ReactNode }) =>
      React.createElement('Group', { title }, children)
  };
});
vi.mock('../theme/theme', () => ({
  useAppTheme: () => ({ preference, setPreference })
}));

const { AppearanceSettings } = await import('./AppearanceSettings.js');

const mount = async () => {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<AppearanceSettings />);
  });
  return renderer;
};
const radios = (renderer: ReactTestRenderer) =>
  renderer.root.findAll(
    (node) =>
      typeof node.type === 'string' &&
      (node.props as { accessibilityRole?: string }).accessibilityRole === 'radio'
  );

describe('appearance setting', () => {
  it('shows three choices and marks the current one as checked', async () => {
    preference = 'dark';
    const renderer = await mount();
    const choices = radios(renderer).map((node) => [
      node.props.accessibilityLabel,
      node.props.accessibilityState.checked
    ]);
    expect(choices).toEqual([
      ['Light', false],
      ['Dark', true],
      ['Match phone', false]
    ]);
  });

  it('applies the choice that is pressed', async () => {
    preference = 'light';
    setPreference.mockClear();
    const renderer = await mount();
    const match = radios(renderer).find((node) => node.props.accessibilityLabel === 'Match phone')!;
    await act(async () => (match.props as { onPress: () => void }).onPress());
    expect(setPreference).toHaveBeenCalledWith('system');
  });

  it('is a labelled group, and says what stays dark', async () => {
    preference = 'light';
    const renderer = await mount();
    const group = renderer.root.find(
      (node) =>
        typeof node.type === 'string' &&
        (node.props as { accessibilityRole?: string }).accessibilityRole === 'radiogroup'
    );
    expect(group.props.accessibilityLabel).toBe('Appearance');
    const texts = renderer.root
      .findAll((node) => (node.type as unknown) === 'Text')
      .map((node) => [node.props.children].flat().join(''));
    expect(texts.join(' ')).toContain('always stay dark');
  });
});
