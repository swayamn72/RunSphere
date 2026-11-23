import React from 'react';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { ApiFailure } from '../api-client';

vi.mock('react-native', async () => {
  const React = await import('react');
  const native =
    (name: string) =>
    ({ children, ...props }: Record<string, unknown>) =>
      React.createElement(name as React.ElementType, props, children as React.ReactNode);
  return {
    Pressable: native('Pressable'),
    Text: native('Text'),
    TextInput: native('TextInput'),
    View: native('View')
  };
});
vi.mock('../components/styles', () => ({
  useAppStyles: () => new Proxy({}, { get: () => ({}) })
}));
vi.mock('../components/primitives', async () => {
  const React = await import('react');
  return {
    BackHeader: () => null,
    PrimaryButton: ({
      label,
      disabled,
      onPress
    }: {
      label: string;
      disabled?: boolean;
      onPress: () => void;
    }) => React.createElement('Pressable', { accessibilityLabel: label, disabled, onPress })
  };
});
vi.mock('../theme/theme', () => ({
  useAppTheme: () => ({ tokens: { text: { secondary: '#555' } } })
}));

const { AccountRecoveryScreen } = await import('./AccountRecoveryScreen.js');

const TOKEN = 'Abc123_-'.repeat(6);

const stubApi = () => ({
  requestPasswordReset: vi.fn(async (_email: string) => undefined),
  completePasswordReset: vi.fn(async (_token: string, _password: string) => undefined),
  requestEmailChange: vi.fn(async (_email: string) => undefined),
  completeEmailChange: vi.fn(async (_token: string) => undefined)
});

const byLabel = (renderer: ReactTestRenderer, label: string) =>
  renderer.root.find(
    (node) => (node.props as { accessibilityLabel?: string }).accessibilityLabel === label
  );
const typeInto = async (renderer: ReactTestRenderer, label: string, value: string) =>
  act(async () =>
    (byLabel(renderer, label).props as { onChangeText: (v: string) => void }).onChangeText(value)
  );
const press = async (renderer: ReactTestRenderer, label: string) =>
  act(async () => (byLabel(renderer, label).props as { onPress: () => void }).onPress());
const texts = (renderer: ReactTestRenderer) =>
  renderer.root
    .findAll((node) => (node.type as unknown) === 'Text')
    .map((node) => [node.props.children].flat().join(''));

const render = async (
  api: ReturnType<typeof stubApi>,
  kind: 'forgot-password' | 'change-email',
  onDone = vi.fn()
) => {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <AccountRecoveryScreen api={api} kind={kind} onBack={() => undefined} onDone={onDone} />
    );
  });
  return { renderer, onDone };
};

describe('forgot password (M3.5)', () => {
  it('asks for the email, then takes the pasted link and a new password', async () => {
    const api = stubApi();
    const { renderer, onDone } = await render(api, 'forgot-password');

    expect(byLabel(renderer, 'Send link').props.disabled).toBe(true);
    await typeInto(renderer, 'Your email', 'maya@example.com');
    await press(renderer, 'Send link');
    expect(api.requestPasswordReset).toHaveBeenCalledWith('maya@example.com');
    expect(texts(renderer).join(' ')).toMatch(/If that address has a TURFR account/);

    await typeInto(
      renderer,
      'Link or code from the email',
      `https://example.com/reset-password?token=${TOKEN}`
    );
    await typeInto(renderer, 'New password', 'a-long-enough-password');
    await typeInto(renderer, 'Confirm new password', 'a-different-password');
    await press(renderer, 'Set new password');
    expect(api.completePasswordReset).not.toHaveBeenCalled();
    expect(texts(renderer)).toContain("Those passwords don't match.");

    await typeInto(renderer, 'Confirm new password', 'a-long-enough-password');
    await press(renderer, 'Set new password');
    expect(api.completePasswordReset).toHaveBeenCalledWith(TOKEN, 'a-long-enough-password');
    expect(onDone).toHaveBeenCalled();
  });

  it('says a link is not a link, and when one has expired', async () => {
    const api = stubApi();
    api.completePasswordReset.mockRejectedValueOnce(new ApiFailure(400, 'expired'));
    const { renderer } = await render(api, 'forgot-password');
    await typeInto(renderer, 'Your email', 'maya@example.com');
    await press(renderer, 'Send link');

    await typeInto(renderer, 'Link or code from the email', 'nonsense');
    await press(renderer, 'Set new password');
    expect(texts(renderer).join(' ')).toMatch(/doesn't look like the link/);

    await typeInto(renderer, 'Link or code from the email', TOKEN);
    await typeInto(renderer, 'New password', 'a-long-enough-password');
    await typeInto(renderer, 'Confirm new password', 'a-long-enough-password');
    await press(renderer, 'Set new password');
    expect(texts(renderer).join(' ')).toMatch(/expired or was already used/);
  });
});

describe('change email (M3.5)', () => {
  it('requests the change, then confirms with the pasted link', async () => {
    const api = stubApi();
    const { renderer, onDone } = await render(api, 'change-email');
    await typeInto(renderer, 'New email', 'new@example.com');
    await press(renderer, 'Send link');
    expect(api.requestEmailChange).toHaveBeenCalledWith('new@example.com');

    await typeInto(renderer, 'Link or code from the email', TOKEN);
    await press(renderer, 'Confirm new email');
    expect(api.completeEmailChange).toHaveBeenCalledWith(TOKEN);
    expect(onDone).toHaveBeenCalled();
  });

  it('says plainly when the address cannot be used', async () => {
    const api = stubApi();
    api.requestEmailChange.mockRejectedValueOnce(new ApiFailure(409, 'taken'));
    const { renderer } = await render(api, 'change-email');
    await typeInto(renderer, 'New email', 'taken@example.com');
    await press(renderer, 'Send link');
    expect(texts(renderer).join(' ')).toMatch(/can't be used/);
  });
});
