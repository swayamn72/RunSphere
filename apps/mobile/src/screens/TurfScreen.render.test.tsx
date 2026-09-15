import React from 'react';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type {
  TerritoryClaim,
  TerritoryClaimActivityResponse,
  TerritoryClaimMapResponse,
  TerritoryClaimSummary
} from '@runsphere/contracts';
import type { MobileApiClient } from '../api-client';

const ME = '00000000-0000-4000-8000-00000000000a';
const RIVAL = '00000000-0000-4000-8000-00000000000b';

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
vi.mock('react-native', async () => {
  const React = await import('react');
  const native =
    (name: string) =>
    ({ children, ...props }: Record<string, unknown>) =>
      React.createElement(name as React.ElementType, props, children as React.ReactNode);
  return {
    Pressable: native('Pressable'),
    ScrollView: native('ScrollView'),
    StyleSheet: { create: <T,>(styles: T) => styles, absoluteFill: {} },
    Text: native('Text'),
    TextInput: native('TextInput'),
    View: native('View')
  };
});
vi.mock('../theme/theme', () => ({
  useAppTheme: () => ({
    colorScheme: 'light',
    reduceMotion: true,
    tokens: {
      action: { primary: '#0A6' },
      background: { canvas: '#fff', surface: '#f7f7f7', surfaceInset: '#eee' },
      border: { subtle: '#ddd' },
      map: { control: '#fff', controlText: '#111', scrim: '#000a' },
      text: { primary: '#111', secondary: '#555', onAccent: '#fff' },
      // The avatar pins render a crew mascot, which reads these.
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
/** A configured provider, so the map branch renders rather than the fallback. */
vi.mock('../maps/map-config', () => ({
  resolveMapRenderPlan: () => ({
    kind: 'provider',
    provider: { styleUrl: 'https://tiles.example.com/style.json', attribution: 'Example' }
  })
}));

const { TurfScreen } = await import('./TurfScreen.js');

const claim = (overrides: Partial<TerritoryClaim> = {}): TerritoryClaim => ({
  id: '00000000-0000-4000-8000-0000000000c1',
  owner: { id: RIVAL, displayName: 'Ravi', avatarKey: 'orbit-04', isSelf: false },
  boundary: [
    [72.8777, 19.076],
    [72.8804, 19.076],
    [72.8804, 19.0787],
    [72.8777, 19.0787]
  ],
  centroid: [72.879, 19.0773],
  areaSqm: 90_000,
  distanceMetres: 1200,
  durationSeconds: 600,
  speedMps: 2,
  seasonMonth: '2026-09',
  captureCount: 1,
  status: 'owned',
  claimedAt: '2026-09-06T05:10:00.000Z',
  ...overrides
});

const MAP_NOTE =
  'Territory shows the loops people ran and who holds them. Anyone who can see a claim can see its outline, the holder’s name, and their time.';

const stubApi = (overrides: {
  map?: TerritoryClaimMapResponse;
  summary?: TerritoryClaimSummary;
  activity?: TerritoryClaimActivityResponse;
  runs?: { id: string; status: string }[];
  claim?: () => Promise<unknown>;
  clusters?: unknown[];
  recommendations?: unknown[];
  history?: unknown;
  events?: unknown[];
  board?: unknown;
}): MobileApiClient =>
  ({
    getTerritoryClaims: () =>
      Promise.resolve(overrides.map ?? { claims: [claim()], truncated: false, mapNote: MAP_NOTE }),
    getTerritoryClaimSummary: () =>
      Promise.resolve(overrides.summary ?? { claimCount: 0, totalAreaSqm: 0, lostCount: 0 }),
    getTerritoryClaimActivity: () => Promise.resolve(overrides.activity ?? { data: [] }),
    listActivities: () => Promise.resolve(overrides.runs ?? []),
    getTerritoryClusters: () => Promise.resolve({ clusters: overrides.clusters ?? [] }),
    getTerritoryEvents: () => Promise.resolve({ data: overrides.events ?? [] }),
    getTerritoryLeaderboard: () =>
      Promise.resolve(
        overrides.board ?? {
          scope: 'individual',
          period: 'season',
          seasonMonth: '2026-09',
          metric: 'area',
          entries: [],
          note: 'Total ground currently held.'
        }
      ),
    getTerritoryRecommendations: () =>
      Promise.resolve({
        data: overrides.recommendations ?? [],
        note: 'An estimate, not a promise.'
      }),
    getTerritoryClaimHistory: () =>
      Promise.resolve(
        overrides.history ?? { lineageId: 'lineage-1', captureCount: 0, entries: [] }
      ),
    claimTerritory:
      overrides.claim ??
      (() =>
        Promise.resolve({
          claimed: true,
          message: 'Ground claimed. Nobody held it before you.',
          takenOverCount: 0,
          isFirstClaim: false
        }))
  }) as unknown as MobileApiClient;

const renderTurf = async (api: MobileApiClient): Promise<ReactTestRenderer> => {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(React.createElement(TurfScreen, { api }));
  });
  await act(async () => {
    await Promise.resolve();
  });
  return renderer;
};

const textOf = (renderer: ReactTestRenderer): string =>
  renderer.root
    .findAllByType('Text' as unknown as React.ElementType)
    .flatMap((node) => node.children.filter((child): child is string => typeof child === 'string'))
    .join(' | ');

/**
 * The claims source by id, not by position: event areas render first, so an
 * index would silently start asserting against the wrong layer.
 */
const claimSource = (renderer: ReactTestRenderer) =>
  renderer.root
    .findAllByType('GeoJSONSource' as unknown as React.ElementType)
    .find((node) => (node.props as { id?: string }).id === 'turf-claims');

const byLabel = (renderer: ReactTestRenderer, label: string) =>
  renderer.root.findAll(
    (node) => (node.props as { accessibilityLabel?: string }).accessibilityLabel === label
  );

/** Drives the map's region-change handler the way a pan or zoom would. */
const moveMap = async (renderer: ReactTestRenderer, bounds: number[], zoom: number) => {
  const map = renderer.root.findByType('Map' as unknown as React.ElementType);
  await act(async () => {
    (
      map.props as { onRegionDidChange: (event: { nativeEvent: unknown }) => void }
    ).onRegionDidChange({
      nativeEvent: { bounds, zoom, center: [72.88, 19.07], bearing: 0, pitch: 0 }
    });
    await Promise.resolve();
  });
};

describe('the turf map', () => {
  it('invites somebody holding nothing to claim some', async () => {
    const renderer = await renderTurf(stubApi({}));

    expect(textOf(renderer)).toContain('You hold no ground yet');
  });

  it('draws the ground people hold once the map has moved', async () => {
    const renderer = await renderTurf(stubApi({}));
    await moveMap(renderer, [72.8, 19, 72.95, 19.15], 13);

    const data = (claimSource(renderer)?.props as { data: { features: unknown[] } }).data;
    expect(data.features).toHaveLength(1);
  });

  it('puts a named pin on every claim', async () => {
    const renderer = await renderTurf(stubApi({}));
    await moveMap(renderer, [72.8, 19, 72.95, 19.15], 13);

    // ADR-0011: this map names holders. The pin is the reversal made visible.
    const pins = byLabel(renderer, 'Ravi holds 9.0 ha in 10:00. Beat that time to take it.');
    expect(pins.length).toBeGreaterThan(0);
  });

  it('tells somebody the time they have to beat when they tap a rival claim', async () => {
    const renderer = await renderTurf(stubApi({}));
    await moveMap(renderer, [72.8, 19, 72.95, 19.15], 13);

    const [pin] = byLabel(renderer, 'Ravi holds 9.0 ha in 10:00. Beat that time to take it.');
    await act(async () => {
      (pin!.props as { onPress: () => void }).onPress();
      await Promise.resolve();
    });

    expect(textOf(renderer)).toContain('Run this loop in under 10:00 to take it.');
  });

  it('warns the holder that a faster runner takes their ground', async () => {
    const mine = claim({
      id: 'mine',
      owner: { id: ME, displayName: 'Me', avatarKey: 'orbit-01', isSelf: true }
    });
    const renderer = await renderTurf(
      stubApi({ map: { claims: [mine], truncated: false, mapNote: MAP_NOTE } })
    );
    await moveMap(renderer, [72.8, 19, 72.95, 19.15], 13);

    const [pin] = byLabel(renderer, 'Your ground, 9.0 ha, held in 10:00.');
    await act(async () => {
      (pin!.props as { onPress: () => void }).onPress();
      await Promise.resolve();
    });

    expect(textOf(renderer)).toContain('Somebody who runs this loop faster than you takes it.');
  });

  it('does not fetch ground while zoomed out to the globe', async () => {
    const getTerritoryClaims = vi.fn(() =>
      Promise.resolve({ claims: [], truncated: false, mapNote: MAP_NOTE })
    );
    const api = {
      ...stubApi({}),
      getTerritoryClaims
    } as unknown as MobileApiClient;
    const renderer = await renderTurf(api);

    await moveMap(renderer, [-180, -85, 180, 85], 2);

    expect(getTerritoryClaims).not.toHaveBeenCalled();
    expect(textOf(renderer)).toContain('Zoom in to a city to see who holds what');
  });

  it('says when there was more ground than it could draw', async () => {
    const renderer = await renderTurf(
      stubApi({ map: { claims: [claim()], truncated: true, mapNote: MAP_NOTE } })
    );
    await moveMap(renderer, [72.8, 19, 72.95, 19.15], 13);

    // Silence here would read as "this is all the ground there is".
    expect(textOf(renderer)).toContain('Zoom in to see it all');
  });

  it('says what the map records about people, under the map', async () => {
    const renderer = await renderTurf(stubApi({}));
    await moveMap(renderer, [72.8, 19, 72.95, 19.15], 13);

    expect(textOf(renderer)).toContain('the holder’s name');
  });

  it('keeps the ground on screen when a refresh fails', async () => {
    let call = 0;
    const api = {
      ...stubApi({}),
      getTerritoryClaims: () => {
        call += 1;
        return call === 1
          ? Promise.resolve({ claims: [claim()], truncated: false, mapNote: MAP_NOTE })
          : Promise.reject(new Error('offline'));
      }
    } as unknown as MobileApiClient;
    const renderer = await renderTurf(api);
    await moveMap(renderer, [72.8, 19, 72.95, 19.15], 13);
    await moveMap(renderer, [73.5, 19, 73.65, 19.15], 13);

    // A map that empties on a dropped request reads as "nobody holds anything
    // here", which is a claim about a city rather than about the network.
    expect(
      (claimSource(renderer)?.props as { data: { features: unknown[] } }).data.features
    ).toHaveLength(1);
    expect(textOf(renderer)).toContain('Showing what was last loaded');
  });

  it('reports takeovers as something that happened to a person', async () => {
    const renderer = await renderTurf(
      stubApi({
        activity: {
          data: [
            {
              id: '00000000-0000-4000-8000-0000000000e1',
              rival: { id: RIVAL, displayName: 'Ravi', avatarKey: 'orbit-04', isSelf: false },
              previousDurationSeconds: 900,
              newDurationSeconds: 720,
              takenFromSelf: true,
              createdAt: '2026-09-06T06:00:00.000Z'
            }
          ]
        }
      })
    );

    expect(textOf(renderer)).toContain('Ravi took your ground — 12:00 against your 15:00.');
  });

  it('offers to claim a finished run, and never claims one on its own', async () => {
    const claimTerritory = vi.fn(() =>
      Promise.resolve({
        claimed: true,
        message: 'Ground claimed.',
        takenOverCount: 0,
        isFirstClaim: false
      })
    );
    const api = {
      ...stubApi({ runs: [{ id: 'run-1', status: 'derived' }] }),
      claimTerritory
    } as unknown as MobileApiClient;
    const renderer = await renderTurf(api);

    // Putting a name on a public map is an act somebody takes, not something
    // that happens to them because they went for a run (ADR-0011).
    expect(claimTerritory).not.toHaveBeenCalled();

    const [button] = byLabel(renderer, 'Claim ground from your last run');
    await act(async () => {
      (button!.props as { onPress: () => void }).onPress();
      await Promise.resolve();
    });

    expect(claimTerritory).toHaveBeenCalledWith('run-1');
  });

  it('offers nothing to claim when no run has been validated', async () => {
    const renderer = await renderTurf(stubApi({ runs: [{ id: 'run-1', status: 'validating' }] }));

    expect(byLabel(renderer, 'Claim ground from your last run')).toEqual([]);
  });

  it('shows the refusal in the server own words when a loop was not claimable', async () => {
    const api = {
      ...stubApi({ runs: [{ id: 'run-1', status: 'derived' }] }),
      claimTerritory: () =>
        Promise.resolve({
          claimed: false,
          refusal: 'slower_than_holder',
          message: 'Someone already holds this ground with a faster loop.',
          takenOverCount: 0,
          isFirstClaim: false
        })
    } as unknown as MobileApiClient;
    const renderer = await renderTurf(api);

    const [button] = byLabel(renderer, 'Claim ground from your last run');
    await act(async () => {
      (button!.props as { onPress: () => void }).onPress();
      await Promise.resolve();
    });

    expect(textOf(renderer)).toContain('already holds this ground with a faster loop');
  });

  it('warns before a first claim that this goes on a public map', async () => {
    const renderer = await renderTurf(stubApi({ runs: [{ id: 'run-1', status: 'derived' }] }));

    // The people most exposed by this map are the ones who never thought to
    // set a private area, so everybody is told once, when it matters.
    expect(textOf(renderer)).toContain('set a private area in Profile settings first');
  });

  it('does not repeat that warning to somebody who already holds ground', async () => {
    const renderer = await renderTurf(
      stubApi({
        runs: [{ id: 'run-1', status: 'derived' }],
        summary: { claimCount: 3, totalAreaSqm: 270_000, lostCount: 0 }
      })
    );

    expect(textOf(renderer)).not.toContain('set a private area in Profile settings first');
  });

  it('points a first-time claimer at privacy zones once the ground is theirs', async () => {
    const api = {
      ...stubApi({ runs: [{ id: 'run-1', status: 'derived' }] }),
      claimTerritory: () =>
        Promise.resolve({
          claimed: true,
          message: 'Ground claimed.',
          takenOverCount: 0,
          isFirstClaim: true
        })
    } as unknown as MobileApiClient;
    const renderer = await renderTurf(api);

    const [button] = byLabel(renderer, 'Claim ground from your last run');
    await act(async () => {
      (button!.props as { onPress: () => void }).onPress();
      await Promise.resolve();
    });

    expect(textOf(renderer)).toContain('now on a public map with your name on it');
  });

  it('shows a live event and what it is for', async () => {
    const renderer = await renderTurf(
      stubApi({
        events: [
          {
            id: 'event-1',
            title: 'Capture the Park',
            description: 'Hold ground in the park this weekend.',
            startsAt: '2000-01-01T00:00:00.000Z',
            endsAt: '2999-01-01T00:00:00.000Z',
            boundary: [
              [72.87, 19.07],
              [72.89, 19.07],
              [72.89, 19.09]
            ],
            centroid: [72.88, 19.08],
            reward: 'A cosmetic badge',
            status: 'live',
            heldClaimCount: 6,
            selfClaimCount: 2
          }
        ]
      })
    );
    const rendered = textOf(renderer);

    expect(rendered).toContain('Capture the Park');
    expect(rendered).toContain('2 of 6 yours');
    // Rewards are cosmetic only, and the screen says which.
    expect(rendered).toContain('A cosmetic badge');
  });

  it('shows the leaderboard and what it counts', async () => {
    const renderer = await renderTurf(
      stubApi({
        board: {
          scope: 'individual',
          period: 'season',
          seasonMonth: '2026-09',
          metric: 'area',
          entries: [
            {
              rank: 1,
              owner: { id: RIVAL, displayName: 'Ravi', avatarKey: 'orbit-04', isSelf: false },
              totalAreaSqm: 270_000,
              claimCount: 3,
              defendedCount: 1,
              isSelf: false
            }
          ],
          note: 'Total ground currently held. Ground you lose stops counting.'
        }
      })
    );
    const rendered = textOf(renderer);

    expect(rendered).toContain('Ravi');
    expect(rendered).toContain('27.0 ha');
    // A board has to say what it counts, or a rank is just a number.
    expect(rendered).toContain('Ground you lose stops counting');
  });
});

describe('the zone bar', () => {
  const MINE = '00000000-0000-4000-8000-0000000000aa';

  const mixedMap = {
    claims: [
      claim({
        id: '00000000-0000-4000-8000-0000000000d1',
        owner: { id: MINE, displayName: 'You', avatarKey: 'orbit-01', isSelf: true },
        cityTag: 'Mumbai'
      }),
      claim({
        id: '00000000-0000-4000-8000-0000000000d2',
        owner: { id: RIVAL, displayName: 'Ravi', avatarKey: 'orbit-04', isSelf: false },
        cityTag: 'Pune',
        status: 'contested' as const
      })
    ],
    truncated: false,
    mapNote: MAP_NOTE
  };

  /** Selects a zone chip the way a person would, by the name it announces. */
  const chooseFilter = async (renderer: ReactTestRenderer, label: string) => {
    const [chip] = byLabel(renderer, label);
    if (!chip) throw new Error(`No zone filter labelled ${label}`);
    await act(async () => (chip.props as { onPress: () => void }).onPress());
  };

  const drawnIds = (renderer: ReactTestRenderer): string[] => {
    const source = claimSource(renderer);
    const data = (
      source?.props as { data?: { features?: { properties?: { claimId?: string } }[] } }
    )?.data;
    return (data?.features ?? []).map((feature) => String(feature.properties?.claimId));
  };

  it('offers the four filters and draws everything by default', async () => {
    const renderer = await renderTurf(stubApi({ map: mixedMap }));
    await moveMap(renderer, [72.87, 19.07, 72.89, 19.09], 14);

    for (const label of ['All', 'My zones', 'Rival zones', 'Contested'])
      expect(byLabel(renderer, label).length).toBeGreaterThan(0);
    expect(drawnIds(renderer)).toHaveLength(2);
    expect(textOf(renderer)).toContain('2 zones in this view.');
  });

  it('narrows the ground drawn to the chosen filter', async () => {
    const renderer = await renderTurf(stubApi({ map: mixedMap }));
    await moveMap(renderer, [72.87, 19.07, 72.89, 19.09], 14);

    await chooseFilter(renderer, 'My zones');
    expect(drawnIds(renderer)).toEqual(['00000000-0000-4000-8000-0000000000d1']);
    expect(textOf(renderer)).toContain('1 of 2 zones in this view.');

    await chooseFilter(renderer, 'Contested');
    expect(drawnIds(renderer)).toEqual(['00000000-0000-4000-8000-0000000000d2']);
  });

  it('says a filtered view is filtered, so it never reads as unclaimed ground', async () => {
    const onlyRivals = {
      ...mixedMap,
      claims: [mixedMap.claims[1]!]
    };
    const renderer = await renderTurf(stubApi({ map: onlyRivals }));
    await moveMap(renderer, [72.87, 19.07, 72.89, 19.09], 14);

    await chooseFilter(renderer, 'My zones');
    expect(drawnIds(renderer)).toHaveLength(0);
    const shown = textOf(renderer);
    expect(shown).toContain('No zone here is yours');
    expect(shown).toContain('1 held in this view');
    expect(shown).not.toContain('No ground is held in this view yet.');
  });

  it('searches the holder and the city the server tagged', async () => {
    const renderer = await renderTurf(stubApi({ map: mixedMap }));
    await moveMap(renderer, [72.87, 19.07, 72.89, 19.09], 14);

    const [field] = byLabel(renderer, 'Search zones by holder or city');
    await act(async () =>
      (field!.props as { onChangeText: (text: string) => void }).onChangeText('ravi')
    );
    expect(drawnIds(renderer)).toEqual(['00000000-0000-4000-8000-0000000000d2']);

    await act(async () =>
      (field!.props as { onChangeText: (text: string) => void }).onChangeText('mumbai')
    );
    expect(drawnIds(renderer)).toEqual(['00000000-0000-4000-8000-0000000000d1']);
  });
});
