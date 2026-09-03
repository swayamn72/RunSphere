import React from 'react';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type {
  ChallengeResult,
  ChallengeSummary,
  FriendStandingsResponse,
  Profile
} from '@runsphere/contracts';
import type { MobileApiClient } from '../api-client';
import { ApiFailure } from '../api-client.js';

const ME = '00000000-0000-4000-8000-00000000000a';
const RAVI = '00000000-0000-4000-8000-00000000000b';

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
vi.mock('../components/Mascot', () => ({ LoopMascot: () => null }));
vi.mock('../components/primitives', () => ({
  PrimaryButton: ({ label }: { label: string }) =>
    React.createElement('Text' as React.ElementType, null, label)
}));
vi.mock('../theme/theme', () => ({
  useAppTheme: () => ({
    colorScheme: 'light',
    tokens: {
      action: { primary: '#0A6' },
      background: { canvas: '#fff', surface: '#f7f7f7', surfaceInset: '#eee' },
      border: { subtle: '#ddd' },
      status: { success: '#0A6' },
      text: { primary: '#111', secondary: '#555', onAccent: '#fff' }
    }
  })
}));

const { PlayScreen } = await import('./PlayScreen.js');

const profile = (id: string, displayName: string): Profile => ({
  id,
  displayName,
  cosmetic: { avatarKey: 'loop-1' },
  activityVisibility: 'private'
});

const challenge = (overrides: Partial<ChallengeSummary> = {}): ChallengeSummary => ({
  id: 'challenge-1',
  mode: 'active_minutes',
  lengthDays: 3,
  status: 'invited',
  role: 'opponent',
  periodStart: '2026-08-31',
  periodEnd: '2026-09-03',
  opponent: profile(RAVI, 'Ravi'),
  ruleVersion: '1',
  createdAt: '2026-08-31T04:00:00.000Z',
  ...overrides
});

const emptyStandings: FriendStandingsResponse = {
  periodStart: '2026-08-31',
  periodEnd: '2026-09-07',
  participating: false,
  entries: []
};

const stubApi = (overrides: {
  challenges?: ChallengeSummary[];
  result?: () => Promise<ChallengeResult>;
  standings?: FriendStandingsResponse;
  friends?: Profile[];
}): MobileApiClient =>
  ({
    listChallenges: () => Promise.resolve(overrides.challenges ?? []),
    getChallengeResult:
      overrides.result ?? (() => Promise.reject(new ApiFailure(409, 'not ready yet'))),
    getFriendStandings: () => Promise.resolve(overrides.standings ?? emptyStandings),
    listFriends: () => Promise.resolve(overrides.friends ?? [])
  }) as unknown as MobileApiClient;

const renderPlay = async (api: MobileApiClient): Promise<ReactTestRenderer> => {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<PlayScreen api={api} accountId={ME} onSessionExpired={() => undefined} />);
  });
  await act(async () => undefined);
  return renderer;
};

const renderedText = (renderer: ReactTestRenderer): string =>
  renderer.root
    .findAllByType('Text' as React.ElementType)
    .flatMap((node) => node.children.filter((child): child is string => typeof child === 'string'))
    .join(' | ');

const hostsMatching = (
  renderer: ReactTestRenderer,
  predicate: (props: Record<string, unknown>) => boolean
) =>
  renderer.root.findAll(
    (node) => typeof node.type === 'string' && predicate(node.props as Record<string, unknown>)
  );

describe('Play tab render', () => {
  it('offers accept and decline only on an invite this account must answer', async () => {
    const renderer = await renderPlay(
      stubApi({
        challenges: [
          challenge({ id: 'incoming', role: 'opponent' }),
          challenge({ id: 'outgoing', role: 'challenger' })
        ]
      })
    );

    const text = renderedText(renderer);
    expect(text).toContain('INVITES FOR YOU');
    expect(text).toContain('WAITING ON A REPLY');
    const accepts = hostsMatching(renderer, (props) =>
      String(props['accessibilityLabel'] ?? '').startsWith('Accept the challenge')
    );
    expect(accepts).toHaveLength(1);
  });

  it('shows no running score for an in-progress challenge', async () => {
    const renderer = await renderPlay(
      stubApi({ challenges: [challenge({ status: 'active', periodEnd: '2999-01-01' })] })
    );

    const text = renderedText(renderer);
    expect(text).toContain('IN PROGRESS');
    expect(text).toContain('Scores are counted once the challenge');
    // Nothing that reads as a score or a lead may appear mid-window.
    expect(text).not.toMatch(/finished ahead|Tied|\d+ to \d+/);
  });

  it('reports a finished-but-unscored challenge as counting, not as a zero', async () => {
    const renderer = await renderPlay(stubApi({ challenges: [challenge({ status: 'finished' })] }));

    const text = renderedText(renderer);
    expect(text).toContain('Counting');
    expect(text).toContain('still being counted');
    expect(text).not.toMatch(/0 to 0|finished ahead/);
  });

  it('renders a stored result once the worker has scored the window', async () => {
    const renderer = await renderPlay(
      stubApi({
        challenges: [challenge({ status: 'finished' })],
        result: () =>
          Promise.resolve({
            id: 'challenge-1',
            mode: 'active_minutes',
            periodStart: '2026-08-31',
            periodEnd: '2026-09-03',
            participants: [
              { accountId: ME, score: 120 },
              { accountId: RAVI, score: 45 }
            ],
            winnerAccountId: ME,
            ruleVersion: '1'
          })
      })
    );

    const text = renderedText(renderer);
    expect(text).toContain('You finished ahead');
    expect(text).toContain('120 to 45 active minutes.');
  });

  it('gates the friend board behind an explicit join rather than showing it empty', async () => {
    const renderer = await renderPlay(stubApi({}));

    const text = renderedText(renderer);
    expect(text).toContain('You are not on the friend board');
    expect(text).toContain('Join the friend board');
    expect(text).not.toContain('Leave the board');
  });

  it('renders served standings rows with one score each and a self marker', async () => {
    const renderer = await renderPlay(
      stubApi({
        standings: {
          periodStart: '2026-08-31',
          periodEnd: '2026-09-07',
          participating: true,
          ruleVersion: '1',
          entries: [
            { profile: profile(RAVI, 'Ravi'), rank: 1, cappedActiveMinutes: 200, isSelf: false },
            { profile: profile(ME, 'Maya'), rank: 2, cappedActiveMinutes: 120, isSelf: true }
          ]
        }
      })
    );

    const text = renderedText(renderer);
    expect(text).toContain('Ravi');
    expect(text).toContain('200 min');
    expect(text).toContain('Maya (you)');
    expect(text).toContain('Leave the board');
    expect(
      hostsMatching(renderer, (props) =>
        String(props['accessibilityLabel'] ?? '').startsWith('Rank 2, Maya (you)')
      )
    ).toHaveLength(1);
    // Scoped to the row labels: the page's own privacy disclaimer legitimately
    // uses the words "pace" and "speed".
    const rowLabels = hostsMatching(renderer, (props) =>
      String(props['accessibilityLabel'] ?? '').startsWith('Rank ')
    ).map((row) => String(row.props['accessibilityLabel']));
    expect(rowLabels).toHaveLength(2);
    expect(rowLabels.join(' ')).not.toMatch(/pace|speed|distance|km|route/i);
  });

  it('offers only the modes the server can score', async () => {
    const renderer = await renderPlay(stubApi({ friends: [profile(RAVI, 'Ravi')] }));

    const compose = hostsMatching(
      renderer,
      (props) => props['accessibilityLabel'] === 'Start a new challenge'
    )[0];
    await act(async () => {
      (compose?.props as { onPress: () => void }).onPress();
    });

    const text = renderedText(renderer);
    expect(text).toContain('Active minutes');
    expect(text).toContain('Active days');
    // No quest completion is recorded server-side, so the option is not offered.
    expect(text).not.toContain('Quest completions');
    expect(text).toContain('3 days');
    expect(text).toContain('7 days');
  });

  it('guides an account with no challenges toward inviting a friend', async () => {
    const renderer = await renderPlay(stubApi({}));
    expect(renderedText(renderer)).toContain('Invite a friend');
  });
});
