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

const { QuestProgressCard } = await import('./QuestProgressCard.js');

const texts = (renderer: ReactTestRenderer) =>
  renderer.root
    .findAll((node) => (node.type as unknown) === 'Text')
    .map((node) => [node.props.children].flat().join(''));
const press = async (renderer: ReactTestRenderer, label: string) => {
  const node = renderer.root.find(
    (candidate) => (candidate.props as { accessibilityLabel?: string }).accessibilityLabel === label
  );
  await act(async () => (node.props as { onPress: () => void }).onPress());
};

describe('quest progress card (M6.3)', () => {
  it('takes a quest on, then lets you drop it', async () => {
    const api = {
      listMyQuests: vi.fn(async () => []),
      acceptQuest: vi.fn(async () => ({
        status: 'accepted' as const,
        acceptedAt: '2026-11-21T00:00:00.000Z'
      })),
      dropQuest: vi.fn(async () => undefined)
    };
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<QuestProgressCard api={api} questId="q1" />);
    });
    expect(texts(renderer)).toContain('Take this quest');

    await press(renderer, 'Take this quest');
    expect(api.acceptQuest).toHaveBeenCalledWith('q1');
    expect(texts(renderer)).toContain("You're on this quest");

    await press(renderer, 'Drop this quest');
    expect(api.dropQuest).toHaveBeenCalledWith('q1');
    expect(texts(renderer)).toContain('Take this quest');
  });

  it('shows a finished quest as done, and nothing when signed out', async () => {
    let done!: ReactTestRenderer;
    await act(async () => {
      done = create(
        <QuestProgressCard
          questId="q1"
          api={{
            listMyQuests: async () => [
              {
                questId: 'q1',
                title: 'Q',
                status: 'completed' as const,
                acceptedAt: '2026-11-20T00:00:00.000Z',
                completedAt: '2026-11-21T00:00:00.000Z'
              }
            ],
            acceptQuest: vi.fn(),
            dropQuest: vi.fn()
          }}
        />
      );
    });
    expect(texts(done)).toContain('Quest complete');

    let signedOut!: ReactTestRenderer;
    await act(async () => {
      signedOut = create(
        <QuestProgressCard
          questId="q1"
          api={{
            listMyQuests: async () => {
              throw new Error('signed out');
            },
            acceptQuest: vi.fn(),
            dropQuest: vi.fn()
          }}
        />
      );
    });
    expect(signedOut.toJSON()).toBeNull();
  });
});
