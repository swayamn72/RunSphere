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
  return { Pressable: native('Pressable'), Text: native('Text'), View: native('View') };
});
vi.mock('../components/styles', () => ({
  useAppStyles: () => new Proxy({}, { get: () => ({}) })
}));
vi.mock('../components/primitives', async () => {
  const React = await import('react');
  return {
    PrimaryButton: ({ label, onPress }: { label: string; onPress: () => void }) =>
      React.createElement('Pressable', { accessibilityLabel: label, onPress })
  };
});

const { OnboardingSocialStep } = await import('./OnboardingSocialStep.js');

const stubApi = () => ({
  savePrivacySettings: vi.fn(async () => ({}) as never),
  saveIdentity: vi.fn(async () => ({}) as never),
  createPrivacyZone: vi.fn(async () => ({}) as never)
});

const press = async (renderer: ReactTestRenderer, label: string) => {
  const node = renderer.root.find(
    (candidate) => (candidate.props as { accessibilityLabel?: string }).accessibilityLabel === label
  );
  await act(async () => (node.props as { onPress: () => void }).onPress());
};

const render = async (
  api: ReturnType<typeof stubApi>,
  location: { latitude: number; longitude: number } | null = { latitude: 19, longitude: 72 }
) => {
  const onDone = vi.fn();
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <OnboardingSocialStep
        api={api}
        captureLocation={async () => location ?? undefined}
        onDone={onDone}
      />
    );
  });
  return { renderer, onDone };
};

describe('sign-up Who can see you step (SI.4)', () => {
  it('starts on Everyone and saves a public, named profile', async () => {
    const api = stubApi();
    const { renderer, onDone } = await render(api);
    await press(renderer, 'Continue');
    expect(api.savePrivacySettings).toHaveBeenCalledWith({
      profileVisibility: 'everyone',
      searchable: true,
      nameOnGround: true
    });
    expect(onDone).toHaveBeenCalled();
  });

  it('keeps a friends-only runner anonymous on Turf, and saves a chosen area', async () => {
    const api = stubApi();
    const { renderer } = await render(api);
    await press(renderer, 'Profile: Friends');
    await press(renderer, 'Choose your area');
    await press(renderer, 'Set your area to Bandra West');
    await press(renderer, 'Continue');
    expect(api.savePrivacySettings).toHaveBeenCalledWith({
      profileVisibility: 'friends',
      searchable: true,
      nameOnGround: false
    });
    expect(api.saveIdentity).toHaveBeenCalledWith({ homeArea: 'Bandra West' });
  });

  it('hides home with the current position, or says how to do it later', async () => {
    const api = stubApi();
    const { renderer } = await render(api);
    await press(renderer, 'Hide 200 metres around where I am now');
    expect(api.createPrivacyZone).toHaveBeenCalledWith({
      name: 'Home',
      center: { latitude: 19, longitude: 72 }
    });

    const refused = stubApi();
    const second = await render(refused, null);
    await press(second.renderer, 'Hide 200 metres around where I am now');
    expect(refused.createPrivacyZone).not.toHaveBeenCalled();
  });

  it('still continues when saving fails', async () => {
    const api = stubApi();
    api.savePrivacySettings.mockRejectedValueOnce(new Error('offline'));
    const { renderer, onDone } = await render(api);
    await press(renderer, 'Continue');
    expect(onDone).toHaveBeenCalled();
  });
});
