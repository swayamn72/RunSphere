import React from 'react';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { themeMock } from '../theme/theme-mock';

vi.mock('react-native', async () => {
  const React = await import('react');
  const native =
    (name: string) =>
    ({ children, ...props }: Record<string, unknown>) =>
      React.createElement(name as React.ElementType, props, children as React.ReactNode);
  return {
    Pressable: native('Pressable'),
    StyleSheet: { create: <T,>(styles: T) => styles },
    Text: native('Text'),
    View: native('View')
  };
});
vi.mock('../theme/theme', () => themeMock('light'));
vi.mock('../components/primitives', async () => {
  const React = await import('react');
  return {
    PrimaryButton: (props: { label: string; onPress: () => void }) =>
      React.createElement('PrimaryButton', {
        accessibilityLabel: props.label,
        onPress: props.onPress
      })
  };
});

const { WelcomeScreen } = await import('./WelcomeScreen.js');

const legal = [
  { page: 'privacy' as const, label: 'Privacy notice', value: '', url: 'https://x.test/privacy' },
  { page: 'terms' as const, label: 'Terms of use', value: '', url: 'https://x.test/terms' }
];

const mount = async (links = legal) => {
  const handlers = { onGetStarted: vi.fn(), onSignIn: vi.fn(), onOpenLegal: vi.fn() };
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<WelcomeScreen legal={links} {...handlers} />);
  });
  const press = async (label: string) => {
    const target = renderer.root.find(
      (node) =>
        typeof node.type === 'string' &&
        (node.props as { accessibilityLabel?: string }).accessibilityLabel === label
    );
    await act(async () => {
      (target.props as { onPress: () => void }).onPress();
    });
  };
  const withRole = (role: string) =>
    renderer.root.findAll(
      (node) =>
        typeof node.type === 'string' &&
        (node.props as { accessibilityRole?: string }).accessibilityRole === role
    );
  return { renderer, handlers, press, withRole };
};

describe('welcome screen', () => {
  it('has one headline and says what the app does', async () => {
    const { renderer, withRole } = await mount();
    expect(withRole('header')).toHaveLength(1);
    const text = JSON.stringify(renderer.toJSON());
    expect(text).toContain('Claim your ground.');
    expect(text).toContain('Claim real streets');
    expect(text).toContain('Your privacy, your call');
  });

  it('offers both ways in', async () => {
    const { handlers, press } = await mount();
    await press('Get started');
    expect(handlers.onGetStarted).toHaveBeenCalledOnce();
    await press('I already have an account');
    expect(handlers.onSignIn).toHaveBeenCalledOnce();
  });

  it('opens a legal page, and shows no links when there is nowhere to link', async () => {
    const { handlers, press, withRole } = await mount();
    expect(withRole('link')).toHaveLength(2);
    await press('Privacy notice');
    expect(handlers.onOpenLegal).toHaveBeenCalledWith('https://x.test/privacy');
    expect((await mount([])).withRole('link')).toHaveLength(0);
  });
});
