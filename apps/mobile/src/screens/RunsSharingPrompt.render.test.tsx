import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { LEGAL_POLICY_VERSION } from '@runsphere/domain';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', async () => {
  const React = await import('react');
  const native =
    (name: string) =>
    ({ children, ...props }: Record<string, unknown>) =>
      React.createElement(name as React.ElementType, props, children as React.ReactNode);
  return {
    Linking: { openURL: vi.fn() },
    Pressable: native('Pressable'),
    Text: native('Text'),
    View: native('View')
  };
});
vi.mock('../components/styles', () => ({ useAppStyles: () => new Proxy({}, { get: () => ({}) }) }));
vi.mock('../components/primitives', async () => {
  const React = await import('react');
  return {
    PrimaryButton: ({ label, onPress }: { label: string; onPress: () => void }) =>
      React.createElement('PrimaryButton' as React.ElementType, { label, onPress })
  };
});

const { RunsSharingPrompt } = await import('./RunsSharingPrompt.js');

const texts = (renderer: ReactTestRenderer) =>
  renderer.root
    .findAll((node) => (node.type as unknown) === 'Text')
    .map((node) => [node.props.children].flat().join(''));

describe('Who sees your runs? (M9 9.27)', () => {
  it('starts on the runner’s setting, saves a new choice and agrees, then lets them in', async () => {
    const api = {
      getLegalConsent: vi.fn(),
      getPrivacySettings: vi.fn(async () => ({ runsVisibility: 'everyone' })),
      savePrivacySettings: vi.fn(async () => ({})),
      acceptLegalPolicy: vi.fn(async () => ({ needsAcceptance: false })),
      legalPageUrl: (page: string) => `https://example.test/${page}`
    };
    const onDone = vi.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <RunsSharingPrompt api={api as never} onDone={onDone} onSignOut={vi.fn()} />
      );
    });
    const radio = (label: string) =>
      renderer.root.find((node) => node.props.accessibilityLabel === `Runs: ${label}`);
    expect(radio('Everyone').props.accessibilityState).toEqual({ selected: true });
    expect(texts(renderer)).toContain('Who sees your runs?');
    expect(texts(renderer)).toContain('Privacy notice');

    await act(async () => {
      radio('Only me').props.onPress();
    });
    expect(texts(renderer)).toContain('Only you see your runs.');
    const agree = renderer.root.find((node) => (node.type as unknown) === 'PrimaryButton');
    await act(async () => {
      await agree.props.onPress();
    });
    expect(api.savePrivacySettings).toHaveBeenCalledWith({ runsVisibility: 'only_me' });
    expect(api.acceptLegalPolicy).toHaveBeenCalledWith(LEGAL_POLICY_VERSION);
    expect(onDone).toHaveBeenCalled();
  });

  it('stays put and says why when agreeing fails', async () => {
    const api = {
      getLegalConsent: vi.fn(),
      getPrivacySettings: vi.fn(async () => ({ runsVisibility: 'friends' })),
      savePrivacySettings: vi.fn(),
      acceptLegalPolicy: vi.fn().mockRejectedValue(new Error('offline')),
      legalPageUrl: () => undefined
    };
    const onDone = vi.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <RunsSharingPrompt api={api as never} onDone={onDone} onSignOut={vi.fn()} />
      );
    });
    await act(async () => {
      await renderer.root
        .find((node) => (node.type as unknown) === 'PrimaryButton')
        .props.onPress();
    });
    expect(onDone).not.toHaveBeenCalled();
    expect(api.savePrivacySettings).not.toHaveBeenCalled();
    expect(texts(renderer).some((line) => /try again/.test(line))).toBe(true);
  });
});
