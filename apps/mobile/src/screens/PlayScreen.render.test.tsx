import React from 'react';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ChallengeResult,
  ChallengeSummary,
  CompetitionStandingsResponse,
  CompetitionSummary,
  FriendStandingsResponse,
  GlobalBoardResponse,
  Profile,
  TerritoryLadderResponse,
  TerritoryMapResponse,
  TerritorySeasonResponse
} from '@runsphere/contracts';
import type { MobileApiClient } from '../api-client';
import { ApiFailure } from '../api-client.js';

const ME = '00000000-0000-4000-8000-00000000000a';
const RAVI = '00000000-0000-4000-8000-00000000000b';

// The season panel renders a map, and the native MapLibre components cannot
// resolve outside a device build. The map itself is covered by
// `MapSurface.render.test.tsx`; here it only needs to be renderable.
vi.mock('@maplibre/maplibre-react-native', async () => {
  const React = await import('react');
  return {
    Camera: React.forwardRef(() => null),
    GeoJSONSource: ({ children, ...props }: Record<string, unknown>) =>
      React.createElement('GeoJSONSource' as React.ElementType, props, children as React.ReactNode),
    Layer: (props: Record<string, unknown>) =>
      React.createElement('Layer' as React.ElementType, props),
    Map: ({ children, ...props }: Record<string, unknown>) =>
      React.createElement('Map' as React.ElementType, props, children as React.ReactNode)
  };
});
vi.mock('react-native', async () => {
  const React = await import('react');
  const native =
    (name: string) =>
    ({ children, ...props }: Record<string, unknown>) =>
      React.createElement(name as React.ElementType, props, children as React.ReactNode);
  return {
    Image: native('Image'),
    Pressable: native('Pressable'),
    StyleSheet: { create: <T,>(styles: T) => styles },
    Text: native('Text'),
    View: native('View')
  };
});
vi.mock('../components/Mascot', () => ({ LoopMascot: () => null }));
vi.mock('../components/primitives', () => ({
  // Rendered as a real pressable so a test can press it the way a person
  // would, by the name a screen reader announces.
  PrimaryButton: ({
    label,
    accessibilityLabel,
    onPress
  }: {
    label: string;
    accessibilityLabel?: string;
    onPress: () => void;
  }) =>
    React.createElement(
      'Pressable' as React.ElementType,
      { accessibilityLabel: accessibilityLabel ?? label, onPress },
      React.createElement('Text' as React.ElementType, null, label)
    )
}));
vi.mock('../theme/theme', () => ({
  useAppTheme: () => ({
    colorScheme: 'light',
    reduceMotion: true,
    tokens: {
      action: { primary: '#0A6' },
      background: { canvas: '#fff', surface: '#f7f7f7', surfaceInset: '#eee' },
      border: { subtle: '#ddd' },
      status: { success: '#0A6' },
      text: { primary: '#111', secondary: '#555', onAccent: '#fff' },
      mascot: {
        body: '#D9EAE0',
        outline: '#386755',
        orbit: '#5D8500',
        pointer: '#087B69',
        eye: '#10251F',
        beacon: '#8FBD18'
      }
    }
  })
}));

const { PlayScreen } = await import('./PlayScreen.js');
const { createMemoryGuidanceStore, setGuidanceStore } = await import('../loop-guidance.js');

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

const emptyGlobalBoard: GlobalBoardResponse = {
  periodStart: '2026-08-31',
  periodEnd: '2026-09-07',
  participating: false,
  entries: []
};

const globalEntry = (id: string, displayName: string, rank: number, minutes: number) => ({
  profile: profile(id, displayName),
  rank,
  cappedActiveMinutes: minutes,
  isSelf: id === ME
});

const COMPETITION = '00000000-0000-4000-8000-0000000000f1';

const competition = (overrides: Partial<CompetitionSummary> = {}): CompetitionSummary => ({
  id: COMPETITION,
  title: 'September steady week',
  mode: 'active_minutes',
  status: 'published',
  periodStart: '2026-09-07',
  periodEnd: '2026-09-14',
  minPriorActiveWeeks: 0,
  rewards: 'A cosmetic badge',
  disputePeriodHours: 48,
  participantCount: 12,
  enrolled: false,
  eligible: true,
  ruleVersion: 1,
  createdAt: '2026-09-01T04:00:00.000Z',
  ...overrides
});

const competitionStandings = (
  overrides: Partial<CompetitionStandingsResponse> = {}
): CompetitionStandingsResponse => ({
  competition: competition({ enrolled: true, status: 'open' }),
  live: true,
  provisional: false,
  entries: [
    { profile: profile(RAVI, 'Ravi'), rank: 1, score: 200, isSelf: false },
    { profile: profile(ME, 'Maya'), rank: 2, score: 120, isSelf: true }
  ],
  ...overrides
});

const CAPTURE_NOTE =
  'Territory capture is not switched on. A season records who is taking part and in which division; no cell is claimed, no location is read, and no rank is calculated.';

const noSeason: TerritorySeasonResponse = { captureNote: CAPTURE_NOTE };

const LADDER_NOTE =
  'Territory standings are shown without names. Points come from where people moved in public space, so this shows your division and where you sit in it, never who is above or below you.';
const MAP_NOTE =
  'This map shows which areas are held this week and which of them are yours. It never shows who holds the others, when anyone was there, or the path anyone took. Areas reset every week.';

/** What the ladder and map actually return today: a season with nothing in it. */
const emptyLadder: TerritoryLadderResponse = {
  seasonId: '00000000-0000-4000-8000-0000000000b1',
  participantCount: 0,
  entries: [],
  captureNote: CAPTURE_NOTE,
  ladderNote: LADDER_NOTE
};
const emptyMap: TerritoryMapResponse = {
  seasonId: '00000000-0000-4000-8000-0000000000b1',
  h3Resolution: 9,
  cells: [],
  captureNote: CAPTURE_NOTE,
  mapNote: MAP_NOTE
};

const season = (
  overrides: Partial<NonNullable<TerritorySeasonResponse['season']>> = {}
): TerritorySeasonResponse => ({
  captureNote: CAPTURE_NOTE,
  season: {
    id: '00000000-0000-4000-8000-0000000000b1',
    title: 'Spring season',
    status: 'open',
    startsAt: '2026-10-01T00:00:00.000Z',
    endsAt: '2026-11-12T00:00:00.000Z',
    joinable: true,
    captureEnabled: false,
    participantCount: 12,
    privacyPolicyVersion: '2026-09',
    ...overrides
  }
});

const stubApi = (overrides: {
  challenges?: ChallengeSummary[];
  result?: () => Promise<ChallengeResult>;
  standings?: FriendStandingsResponse;
  globalBoard?: GlobalBoardResponse;
  setGlobalParticipation?: (participating: boolean) => Promise<boolean>;
  competitions?: CompetitionSummary[];
  competitionStandings?: CompetitionStandingsResponse;
  setCompetitionEnrollment?: (
    competitionId: string,
    enrolled: boolean
  ) => Promise<CompetitionSummary>;
  territory?: TerritorySeasonResponse;
  territoryLadder?: TerritoryLadderResponse;
  territoryMap?: TerritoryMapResponse;
  setTerritoryEnrollment?: () => Promise<TerritorySeasonResponse>;
  friends?: Profile[];
}): MobileApiClient =>
  ({
    listChallenges: () => Promise.resolve(overrides.challenges ?? []),
    getChallengeResult:
      overrides.result ?? (() => Promise.reject(new ApiFailure(409, 'not ready yet'))),
    getFriendStandings: () => Promise.resolve(overrides.standings ?? emptyStandings),
    getGlobalBoard: () => Promise.resolve(overrides.globalBoard ?? emptyGlobalBoard),
    setGlobalBoardParticipation: vi.fn(
      overrides.setGlobalParticipation ??
        ((participating: boolean) => Promise.resolve(participating))
    ),
    listCompetitions: () => Promise.resolve(overrides.competitions ?? []),
    getTerritorySeason: () => Promise.resolve(overrides.territory ?? noSeason),
    getTerritoryLadder: () => Promise.resolve(overrides.territoryLadder ?? emptyLadder),
    getTerritoryMap: () => Promise.resolve(overrides.territoryMap ?? emptyMap),
    setTerritoryEnrollment: vi.fn(
      overrides.setTerritoryEnrollment ?? (() => Promise.resolve(overrides.territory ?? noSeason))
    ),
    getCompetitionStandings: () =>
      Promise.resolve(overrides.competitionStandings ?? competitionStandings()),
    setCompetitionEnrollment: vi.fn(
      overrides.setCompetitionEnrollment ??
        ((_competitionId: string, enrolled: boolean) => Promise.resolve(competition({ enrolled })))
    ),
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

/** Controls addressed the way a screen reader would find them. */
const byLabelText = (renderer: ReactTestRenderer, label: string) =>
  renderer.root.findAll(
    (node) =>
      typeof node.type === 'string' &&
      (node.props as Record<string, unknown>)['accessibilityLabel'] === label
  );

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
  // Guidance caps are per installation, so each case starts from a clean slate
  // rather than inheriting the cue budget the previous case spent.
  beforeEach(() => setGuidanceStore(createMemoryGuidanceStore()));

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

  it('lets Coda explain a waiting invite, with a dismiss control of its own', async () => {
    const renderer = await renderPlay(
      stubApi({ challenges: [challenge({ id: 'incoming', role: 'opponent' })] })
    );

    expect(renderedText(renderer)).toContain('Coda');
    const dismiss = hostsMatching(
      renderer,
      (props) => props['accessibilityLabel'] === 'Dismiss guidance from Coda'
    );
    expect(dismiss).toHaveLength(1);

    await act(async () => (dismiss[0]!.props as { onPress: () => void }).onPress());
    expect(
      hostsMatching(
        renderer,
        (props) => props['accessibilityLabel'] === 'Dismiss guidance from Coda'
      )
    ).toHaveLength(0);
  });

  it('says nothing extra when there is no invite waiting on an answer', async () => {
    const renderer = await renderPlay(
      stubApi({ challenges: [challenge({ id: 'outgoing', role: 'challenger' })] })
    );

    expect(
      hostsMatching(renderer, (props) =>
        String(props['accessibilityLabel'] ?? '').startsWith('Dismiss guidance')
      )
    ).toHaveLength(0);
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

describe('the global board', () => {
  it('gates it behind an explicit join and says what joining publishes', async () => {
    const renderer = await renderPlay(stubApi({}));
    const rendered = renderedText(renderer);

    expect(rendered).toContain('You are not on the global board');
    expect(rendered).toContain('Never your route, pace, distance, or where you went');
    expect(rendered).toContain('similar length of time on RunSphere');
  });

  it('renders the served page with the division it was ranked in', async () => {
    const renderer = await renderPlay(
      stubApi({
        globalBoard: {
          periodStart: '2026-08-31',
          periodEnd: '2026-09-07',
          participating: true,
          division: 'rising',
          ruleVersion: 1,
          me: { rank: 2, cappedActiveMinutes: 120 },
          entries: [globalEntry(RAVI, 'Ravi', 1, 200), globalEntry(ME, 'Maya', 2, 120)]
        }
      })
    );
    const rendered = renderedText(renderer);

    expect(rendered).toContain('Rising');
    expect(rendered).toContain('Ravi');
    expect(rendered).toContain('200 min');
    expect(rendered).toContain('Maya (you)');
    expect(rendered).toContain('You are #2 with 120 min');
    // A division is a length of time on RunSphere, never a pace or a place.
    expect(rendered).toContain('how many weeks you have been active');
    // An entry is a rank, a name, and one number of minutes — nothing else.
    const labels = renderer.root
      .findAll(
        (node) =>
          typeof node.type === 'string' &&
          String((node.props as Record<string, unknown>)['accessibilityLabel'] ?? '').startsWith(
            'Rank '
          )
      )
      .map((node) => String((node.props as Record<string, unknown>)['accessibilityLabel']));
    expect(labels).toEqual([
      'Rank 1, Ravi, 200 counted active minutes',
      'Rank 2, Maya (you), 120 counted active minutes'
    ]);
  });

  it('explains an empty board to somebody who has joined but not moved', async () => {
    const renderer = await renderPlay(
      stubApi({
        globalBoard: {
          periodStart: '2026-08-31',
          periodEnd: '2026-09-07',
          participating: true,
          entries: []
        }
      })
    );

    expect(renderedText(renderer)).toContain('Your first counted minutes this week put you on it');
  });

  it('offers a way off the board that reaches the server', async () => {
    const api = stubApi({
      globalBoard: {
        periodStart: '2026-08-31',
        periodEnd: '2026-09-07',
        participating: true,
        division: 'newcomer',
        me: { rank: 1, cappedActiveMinutes: 30 },
        entries: [globalEntry(ME, 'Maya', 1, 30)]
      }
    });
    const renderer = await renderPlay(api);
    const leave = renderer.root.findAll(
      (node) =>
        typeof node.type === 'string' &&
        (node.props as Record<string, unknown>)['accessibilityLabel'] === 'Leave the global board'
    )[0]!;
    await act(async () => (leave.props as { onPress: () => void }).onPress());

    expect(
      (api as unknown as { setGlobalBoardParticipation: ReturnType<typeof vi.fn> })
        .setGlobalBoardParticipation
    ).toHaveBeenCalledWith(false);
  });
});

describe('scheduled competitions', () => {
  it('says nothing is scheduled rather than showing an empty list', async () => {
    const renderer = await renderPlay(stubApi({}));

    expect(renderedText(renderer)).toContain('No competition is scheduled');
  });

  it('announces the window, entrants, and rewards before anybody enters', async () => {
    const renderer = await renderPlay(stubApi({ competitions: [competition()] }));
    const rendered = renderedText(renderer);

    expect(rendered).toContain('September steady week');
    expect(rendered).toContain('Announced');
    expect(rendered).toContain('2026-09-07 to 2026-09-14');
    expect(rendered).toContain('12 entrants');
    expect(rendered).toContain('Rewards: A cosmetic badge');
    expect(rendered).toContain('The whole window is scored however late you enter');
  });

  it('states an eligibility band whether or not the reader clears it', async () => {
    const renderer = await renderPlay(
      stubApi({ competitions: [competition({ minPriorActiveWeeks: 8, eligible: false })] })
    );
    const rendered = renderedText(renderer);

    expect(rendered).toContain('8 or more earlier active weeks');
    expect(rendered).toContain('not you yet');
    // An account that cannot enter is not offered a control that would fail.
    expect(byLabelText(renderer, 'Enter the competition')).toHaveLength(0);
  });

  it('enters a competition and reports the failure the server published', async () => {
    const api = stubApi({
      competitions: [competition()],
      setCompetitionEnrollment: () => {
        throw new ApiFailure(
          403,
          'This competition is for accounts with at least 8 earlier active weeks'
        );
      }
    });
    const renderer = await renderPlay(api);
    const enter = byLabelText(renderer, 'Enter the competition')[0]!;
    await act(async () => (enter.props as { onPress: () => void }).onPress());
    await act(async () => undefined);

    expect(renderedText(renderer)).toContain('at least 8 earlier active weeks');
  });

  it('shows standings to an entrant and marks a provisional result as provisional', async () => {
    const closed = competition({
      enrolled: true,
      status: 'closed',
      disputeEndsAt: '2026-09-16T00:00:00.000Z'
    });
    const renderer = await renderPlay(
      stubApi({
        competitions: [closed],
        competitionStandings: competitionStandings({
          competition: closed,
          live: false,
          provisional: true
        })
      })
    );
    const rendered = renderedText(renderer);

    expect(rendered).toContain('Provisional result');
    expect(rendered).toContain('provisional until 2026-09-16T00:00:00.000Z');
    expect(rendered).toContain('Ravi');
    expect(rendered).toContain('Maya (you)');
  });

  it('offers no entry control once the window has closed', async () => {
    const renderer = await renderPlay(
      stubApi({ competitions: [competition({ status: 'finalized', enrolled: true })] })
    );

    expect(renderedText(renderer)).toContain('Final result');
    expect(byLabelText(renderer, 'Leave the competition')).toHaveLength(0);
  });
});

describe('the territory season', () => {
  it('says no season is running, and points at what to do instead', async () => {
    const renderer = await renderPlay(stubApi({}));
    const rendered = renderedText(renderer);

    expect(rendered).toContain('No season is running');
    expect(rendered).toContain('Quests and your weekly goal');
    // A season is not a permanent fixture, so nothing promises one is coming.
    expect(rendered).not.toMatch(/coming soon|next season starts/i);
  });

  it('says capture is off wherever a season is shown', async () => {
    const withSeason = await renderPlay(stubApi({ territory: season() }));
    const without = await renderPlay(stubApi({}));

    // The word "season" promises a map, and there is no map yet — so the note
    // appears in both states rather than only where a season exists.
    expect(renderedText(withSeason)).toContain('no cell is claimed');
    expect(renderedText(without)).toContain('no cell is claimed');
  });

  it('never displays a rank, because none is calculated', async () => {
    const renderer = await renderPlay(
      stubApi({ territory: season(), territoryLadder: emptyLadder, territoryMap: emptyMap })
    );
    const rendered = renderedText(renderer);

    // `product.md` is explicit for a season somebody has not joined: do not
    // calculate or display a rank. There is none to display, and the standings
    // panel says why rather than showing an empty list.
    expect(rendered).not.toMatch(/#\d|Rank \d/);
    expect(rendered).toContain('Join the season to see your group');
  });

  it('says why the map is not drawn instead of showing an empty city', async () => {
    const renderer = await renderPlay(
      stubApi({ territory: season(), territoryLadder: emptyLadder, territoryMap: emptyMap })
    );
    const rendered = renderedText(renderer);

    // Somebody who has not joined is told that, rather than shown a blank map
    // that would read as an unclaimed city.
    expect(rendered).toContain('Join the season to see the areas your group is playing for');
    expect(rendered).toContain('never shows who holds the others');
  });

  it('tells a participant nothing is held yet, which is a different thing', async () => {
    const renderer = await renderPlay(
      stubApi({
        territory: season(),
        territoryLadder: emptyLadder,
        territoryMap: { ...emptyMap, weekStartsOn: '2026-10-05' }
      })
    );

    expect(renderedText(renderer)).toContain('No areas are held this week yet');
  });

  it('offers an explicit join and says what taking part records', async () => {
    const renderer = await renderPlay(stubApi({ territory: season() }));
    const rendered = renderedText(renderer);

    expect(rendered).toContain('Spring season');
    expect(rendered).toContain('12 taking part');
    expect(rendered).toContain('Nothing about where you go is read');
    expect(byLabelText(renderer, 'Take part')).toHaveLength(1);
  });

  it('shows the division and explains how it was decided', async () => {
    const renderer = await renderPlay(
      stubApi({
        territory: season({
          enrollment: {
            division: 'returning',
            priorActiveWeeks: 9,
            enrolledAt: '2026-09-20T10:00:00.000Z'
          }
        })
      })
    );
    const rendered = renderedText(renderer);

    expect(rendered).toContain('Your group: Returning');
    // The explanation is the point: a label somebody cannot question is worse
    // than no label.
    expect(rendered).toContain('active in 9 earlier weeks');
    expect(rendered).toContain('nothing you do later moves you');
    expect(byLabelText(renderer, 'Leave the season')).toHaveLength(1);
  });

  it('never shows a rank, because none is calculated', async () => {
    const renderer = await renderPlay(
      stubApi({
        territory: season({
          status: 'live',
          enrollment: {
            division: 'newcomer',
            priorActiveWeeks: 0,
            enrolledAt: '2026-10-02T10:00:00.000Z'
          }
        })
      })
    );
    // Scoped to the season card: the Play tab shows ranks elsewhere, and this
    // is about the season not inventing one.
    const card = byLabelText(
      renderer,
      'Spring season. Running. 2026-10-01 to 2026-11-12. 12 taking part. You are taking part.'
    )[0]!;
    const cardText = card
      .findAllByType('Text' as React.ElementType)
      .flatMap((node) =>
        node.children.filter((child): child is string => typeof child === 'string')
      )
      .join(' | ');

    expect(cardText).toContain('Running');
    // The card *says* there is no rank, which is the point — what it must not
    // do is show one: no position, no held-cell count, no standing.
    expect(cardText).toContain('no rank is calculated');
    expect(cardText).not.toMatch(/#\d|Rank \d|\d+(st|nd|rd|th) place|cells held/i);
  });

  it('offers no join control on a season that cannot be joined', async () => {
    const renderer = await renderPlay(
      stubApi({ territory: season({ status: 'announced', joinable: false }) })
    );

    expect(renderedText(renderer)).toContain('Announced');
    expect(byLabelText(renderer, 'Take part')).toHaveLength(0);
  });

  it('takes part and reports a refusal in the server own words', async () => {
    const api = stubApi({
      territory: season(),
      setTerritoryEnrollment: () => {
        throw new ApiFailure(409, 'That season is not open for enrollment');
      }
    });
    const renderer = await renderPlay(api);
    await act(async () =>
      (byLabelText(renderer, 'Take part')[0]!.props as { onPress: () => void }).onPress()
    );
    await act(async () => undefined);

    expect(renderedText(renderer)).toContain('not open to join');
  });
});
