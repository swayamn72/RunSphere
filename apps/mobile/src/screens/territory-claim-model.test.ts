import { describe, expect, it } from 'vitest';
import type {
  TerritoryClaim,
  TerritoryClaimActivityItem,
  TerritoryClaimBounds,
  TerritoryEvent,
  TerritoryLeaderboardResponse
} from '@runsphere/contracts';
import {
  OWNER_PALETTE,
  TIER_HINT,
  captureCelebration,
  clusterMarkers,
  crewForAvatar,
  activeEvents,
  detailTierFor,
  efficiencyLabel,
  eventFeatures,
  eventLine,
  historyLine,
  leaderboardRows,
  recommendationLine,
  showsClusters,
  statusLabel,
  territoryFacts,
  SELF_COLOUR,
  TRUNCATED_NOTE,
  boundsFrom,
  claimFeatures,
  claimMarkers,
  formatArea,
  formatLoopTime,
  ownerColour,
  summaryLine,
  takeoverLine,
  worthRefetching
} from './territory-claim-model.js';

const ME = '00000000-0000-4000-8000-00000000000a';
const RIVAL = '00000000-0000-4000-8000-00000000000b';

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
  captureCount: 1,
  status: 'owned',
  claimedAt: '2026-09-06T05:10:00.000Z',
  ...overrides
});

describe('who is which colour', () => {
  it('gives one account the same colour every time', () => {
    // A rival that changes colour between sessions makes the map unreadable.
    expect(ownerColour(RIVAL)).toBe(ownerColour(RIVAL));
    expect(OWNER_PALETTE).toContain(ownerColour(RIVAL));
  });

  it('gives different accounts different colours often enough to read', () => {
    const ids = Array.from(
      { length: 40 },
      (_unused, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
    );
    const distinct = new Set(ids.map((id) => ownerColour(id)));

    expect(distinct.size).toBeGreaterThan(4);
  });

  it('always paints the reader own ground the same, whatever their id', () => {
    expect(ownerColour(ME, true)).toBe(SELF_COLOUR);
    expect(ownerColour(RIVAL, true)).toBe(SELF_COLOUR);
  });
});

describe('the claims as a map layer', () => {
  it('closes the ring, because GeoJSON needs it and the wire does not', () => {
    const features = claimFeatures([claim()]);
    const ring = features.features[0]!.geometry.coordinates[0]!;

    expect(ring).toHaveLength(5);
    expect(ring[0]).toEqual(ring[4]);
  });

  it('carries colour and ownership so one paint pass can draw everything', () => {
    const features = claimFeatures([
      claim(),
      claim({
        id: 'mine',
        owner: { id: ME, displayName: 'Me', avatarKey: 'orbit-01', isSelf: true }
      })
    ]);

    expect(features.features[0]!.properties).toMatchObject({ isSelf: false });
    expect(features.features[1]!.properties).toMatchObject({ isSelf: true, colour: SELF_COLOUR });
  });

  it('drops a claim with too few points to be an area', () => {
    expect(claimFeatures([claim({ boundary: [[72, 19]] })]).features).toEqual([]);
  });
});

describe('the avatar pins', () => {
  it('sits one at each claim centroid', () => {
    const markers = claimMarkers([claim()]);

    expect(markers[0]?.lngLat).toEqual([72.879, 19.0773]);
    expect(markers[0]?.displayName).toBe('Ravi');
  });

  it('tells a screen reader whose ground it is and the time to beat', () => {
    // The map is the one surface where a sighted reader gets everything from
    // position and colour, so the label has to carry both facts.
    const [rival] = claimMarkers([claim()]);
    const [mine] = claimMarkers([
      claim({ owner: { id: ME, displayName: 'Me', avatarKey: 'orbit-01', isSelf: true } })
    ]);

    expect(rival?.accessibilityLabel).toBe(
      'Ravi holds 9.0 ha in 10:00. Beat that time to take it.'
    );
    expect(mine?.accessibilityLabel).toBe('Your ground, 9.0 ha, held in 10:00.');
  });
});

describe('wording a time and an area', () => {
  it('reads a loop time the way a lap time is read', () => {
    expect(formatLoopTime(600)).toBe('10:00');
    expect(formatLoopTime(63)).toBe('1:03');
    expect(formatLoopTime(-5)).toBe('0:00');
  });

  it('uses the unit somebody can picture', () => {
    expect(formatArea(90_000)).toBe('9.0 ha');
    expect(formatArea(2_500_000)).toBe('2.5 km²');
  });
});

describe('when to ask the server again', () => {
  const bounds = (west: number, south: number): TerritoryClaimBounds => ({
    west,
    south,
    east: west + 0.1,
    north: south + 0.1
  });

  it('always fetches the first viewport', () => {
    expect(worthRefetching(undefined, bounds(72.8, 19))).toBe(true);
  });

  it('ignores the small pans a gesture fires constantly', () => {
    // A map emits a change per frame; refetching each one puts the network in
    // the middle of somebody's thumb.
    expect(worthRefetching(bounds(72.8, 19), bounds(72.801, 19.001))).toBe(false);
  });

  it('fetches after a real pan', () => {
    expect(worthRefetching(bounds(72.8, 19), bounds(72.85, 19))).toBe(true);
  });

  it('fetches after a zoom, even without a pan', () => {
    const zoomedOut: TerritoryClaimBounds = { west: 72.8, south: 19, east: 73.2, north: 19.4 };

    expect(worthRefetching(bounds(72.8, 19), zoomedOut)).toBe(true);
  });

  it('reads the map own bounds order without rearranging it', () => {
    expect(boundsFrom([72.8, 19, 72.95, 19.15])).toEqual({
      west: 72.8,
      south: 19,
      east: 72.95,
      north: 19.15
    });
  });
});

describe('what the reader is told about their own ground', () => {
  it('invites somebody holding nothing to go and claim some', () => {
    expect(summaryLine(undefined)).toContain('Run a closed loop');
    expect(summaryLine({ claimCount: 0, totalAreaSqm: 0, lostCount: 0 })).toContain(
      'Run a closed loop'
    );
  });

  it('reports ground held, and ground lost when there is any', () => {
    expect(summaryLine({ claimCount: 3, totalAreaSqm: 270_000, lostCount: 0 })).toBe(
      '3 claims, 27.0 ha'
    );
    expect(summaryLine({ claimCount: 1, totalAreaSqm: 90_000, lostCount: 2 })).toBe(
      '1 claim, 9.0 ha · 2 taken from you'
    );
  });

  it('never states a rank, because this mechanic has none', () => {
    expect(summaryLine({ claimCount: 3, totalAreaSqm: 270_000, lostCount: 1 })).not.toMatch(
      /#\d|rank/i
    );
  });
});

describe('the takeover feed', () => {
  const event = (
    overrides: Partial<TerritoryClaimActivityItem> = {}
  ): TerritoryClaimActivityItem => ({
    id: '00000000-0000-4000-8000-0000000000e1',
    rival: { id: RIVAL, displayName: 'Ravi', avatarKey: 'orbit-04', isSelf: false },
    previousDurationSeconds: 900,
    newDurationSeconds: 720,
    takenFromSelf: true,
    createdAt: '2026-09-06T06:00:00.000Z',
    ...overrides
  });

  it('says who took your ground and both times', () => {
    // Losing ground silently is the fastest way to make this feel broken.
    expect(takeoverLine(event())).toBe('Ravi took your ground — 12:00 against your 15:00.');
  });

  it('says the same the other way round when you took theirs', () => {
    expect(takeoverLine(event({ takenFromSelf: false }))).toBe(
      'You took ground from Ravi — 12:00 against their 15:00.'
    );
  });

  it('still reads after the other account is gone', () => {
    const anonymous = event();
    delete (anonymous as { rival?: unknown }).rival;

    expect(takeoverLine(anonymous)).toContain('Someone took your ground');
  });
});

describe('a viewport with more ground than fits', () => {
  it('says so rather than letting a partial map read as the whole city', () => {
    expect(TRUNCATED_NOTE).toContain('Zoom in');
  });
});

describe('how much detail a zoom level shows', () => {
  it('runs from a globe to a street', () => {
    expect(detailTierFor(2)).toBe('world');
    expect(detailTierFor(8)).toBe('region');
    expect(detailTierFor(13)).toBe('city');
    expect(detailTierFor(17)).toBe('street');
  });

  it('draws blobs zoomed out and territories zoomed in', () => {
    // Thousands of small polygons is a slow response and an unreadable
    // picture, so the far zooms ask a different question entirely.
    expect(showsClusters('world')).toBe(true);
    expect(showsClusters('region')).toBe(true);
    expect(showsClusters('city')).toBe(false);
    expect(showsClusters('street')).toBe(false);
  });

  it('tells the reader what to do at a zoom that shows no territories', () => {
    expect(TIER_HINT.world).toContain('Zoom in');
    expect(TIER_HINT.region).toContain('Zoom in');
    expect(TIER_HINT.city).toBe('');
  });
});

describe('activity blobs', () => {
  const cluster = (overrides: Record<string, unknown> = {}) => ({
    centroid: [72.87, 19.07] as [number, number],
    claimCount: 40,
    totalAreaSqm: 3_600_000,
    holderCount: 12,
    includesSelf: false,
    ...overrides
  });

  it('counts people rather than polygons', () => {
    // "12 runners hold ground here" is a thing somebody can picture.
    const [bubble] = clusterMarkers([cluster()]);

    expect(bubble?.label).toBe('12');
    expect(bubble?.accessibilityLabel).toContain('12 runners hold ground here');
  });

  it('marks a place where the reader holds something', () => {
    const [bubble] = clusterMarkers([cluster({ includesSelf: true })]);

    expect(bubble?.includesSelf).toBe(true);
    expect(bubble?.accessibilityLabel).toContain('including you');
  });

  it('grows with activity but cannot swallow the map', () => {
    const [small] = clusterMarkers([cluster({ claimCount: 2 })]);
    const [huge] = clusterMarkers([cluster({ claimCount: 500_000 })]);

    expect(huge!.size).toBeGreaterThan(small!.size);
    expect(huge!.size).toBeLessThanOrEqual(64);
  });
});

describe('avatars on the map', () => {
  it('gives one person the same face every time', () => {
    // There are no uploaded photos in this product; a cosmetic key maps to a
    // crew mascot, and it has to be stable or the map is unreadable.
    expect(crewForAvatar('orbit-04')).toBe(crewForAvatar('orbit-04'));
    expect(['rho', 'mira', 'coda', 'bram']).toContain(crewForAvatar('orbit-04'));
  });
});

describe('what a territory card says', () => {
  it('words the state a person can act on', () => {
    expect(statusLabel(claim())).toBe('Held');
    expect(statusLabel(claim({ status: 'contested', captureCount: 4 }))).toBe('Contested ground');
    expect(
      statusLabel(
        claim({ status: 'club_controlled', club: { id: 'c1', name: 'Somaiya Run Club' } })
      )
    ).toBe('Held for Somaiya Run Club');
  });

  it('states what it takes to run it and how hard it has been fought over', () => {
    expect(territoryFacts(claim())).toBe('9.0 ha · 1.2 km loop · record 10:00 · never taken');
    expect(territoryFacts(claim({ captureCount: 5 }))).toContain('changed hands 5 times');
  });

  it('reads a line of the ground history', () => {
    expect(
      historyLine({
        claimId: 'c1',
        owner: { id: RIVAL, displayName: 'Ravi', avatarKey: 'orbit-04', isSelf: false },
        durationSeconds: 900,
        areaSqm: 90_000,
        claimedAt: '2026-09-01T05:00:00.000Z',
        releasedAt: '2026-09-04T05:00:00.000Z'
      })
    ).toBe('Ravi — 15:00, held from 2026-09-01');
  });
});

describe('a recommendation', () => {
  it('never shows a percentage without the two times behind it', () => {
    const line = recommendationLine({
      claim: claim(),
      distanceMetres: 5000,
      targetSeconds: 1800,
      estimatedSeconds: 1650,
      successProbability: 0.72,
      difficulty: 'comfortable',
      efficiency: 0.78,
      reason: 'because'
    });

    expect(line).toContain('beat 30:00');
    expect(line).toContain('about 27:30');
    expect(line).toContain('72%');
  });
});

describe('the capture celebration', () => {
  it('distinguishes taking ground from claiming empty ground', () => {
    expect(captureCelebration(claim(), 0).headline).toBe('Territory claimed');
    expect(captureCelebration(claim(), 0).detail).toContain('nobody held it before you');
    expect(captureCelebration(claim(), 2).headline).toBe('Territory taken');
    expect(captureCelebration(claim(), 2).detail).toContain('beat 2 holders');
  });

  it('still reads when the claim did not come back', () => {
    expect(captureCelebration(undefined, 0).headline).toBe('Territory claimed');
  });
});

describe('the leaderboard', () => {
  const board = (
    overrides: Partial<TerritoryLeaderboardResponse> = {}
  ): TerritoryLeaderboardResponse => ({
    scope: 'individual',
    metric: 'area',
    entries: [
      {
        rank: 1,
        owner: { id: RIVAL, displayName: 'Ravi', avatarKey: 'orbit-04', isSelf: false },
        totalAreaSqm: 270_000,
        claimCount: 3,
        defendedCount: 1,
        isSelf: false
      },
      {
        rank: 2,
        owner: { id: ME, displayName: 'Me', avatarKey: 'orbit-01', isSelf: true },
        totalAreaSqm: 90_000,
        claimCount: 1,
        defendedCount: 0,
        isSelf: true
      }
    ],
    note: 'Total ground currently held.',
    ...overrides
  });

  it('marks the reader own row', () => {
    const rows = leaderboardRows(board());

    expect(rows[1]?.name).toBe('Me (you)');
    expect(rows[1]?.isSelf).toBe(true);
  });

  it('words the detail to match what the board counts', () => {
    expect(leaderboardRows(board())[0]?.detail).toBe('27.0 ha');
    expect(leaderboardRows(board({ metric: 'claims' }))[0]?.detail).toBe('3 territories');
    expect(leaderboardRows(board({ metric: 'defended' }))[0]?.detail).toContain('1 defended');
  });

  it('shows a club board without pretending a club is a person', () => {
    const clubs = board({
      scope: 'club',
      entries: [
        {
          rank: 1,
          club: { id: 'club-1', name: 'Somaiya Run Club' },
          totalAreaSqm: 4_280_000,
          claimCount: 12,
          defendedCount: 4,
          isSelf: false
        }
      ]
    });

    expect(leaderboardRows(clubs)[0]?.name).toBe('Somaiya Run Club');
  });

  it('appends a reader outside the page without inventing their position', () => {
    const rows = leaderboardRows(
      board({
        entries: [board().entries[0]!],
        self: {
          rank: 101,
          owner: { id: ME, displayName: 'Me', avatarKey: 'orbit-01', isSelf: true },
          totalAreaSqm: 9_000,
          claimCount: 1,
          defendedCount: 0,
          isSelf: true
        }
      })
    );

    // The server cannot cheaply know an exact rank past the page, so the app
    // does not print a number it was not given.
    expect(rows).toHaveLength(2);
    expect(rows[1]?.rankLabel).toBe('—');
    expect(rows[1]?.accessibilityLabel).toContain('outside the top');
  });
});

describe('map events', () => {
  const event = (overrides: Partial<TerritoryEvent> = {}): TerritoryEvent => ({
    id: 'event-1',
    title: 'Capture the Park',
    description: 'Hold ground in the park this weekend.',
    startsAt: '2026-09-10T00:00:00.000Z',
    endsAt: '2026-09-14T00:00:00.000Z',
    boundary: [
      [72.87, 19.07],
      [72.89, 19.07],
      [72.89, 19.09],
      [72.87, 19.09]
    ],
    centroid: [72.88, 19.08],
    reward: 'A cosmetic badge',
    status: 'live',
    heldClaimCount: 6,
    selfClaimCount: 2,
    ...overrides
  });

  it('says what it is, when it ends, and how much of it is yours', () => {
    const line = eventLine(event(), new Date('2026-09-12T00:00:00.000Z'));

    expect(line).toContain('Capture the Park');
    expect(line).toContain('ends 2026-09-14');
    expect(line).toContain('2 of 6 yours');
  });

  it('says when an event has not started', () => {
    expect(eventLine(event(), new Date('2026-09-01T00:00:00.000Z'))).toContain('starts 2026-09-10');
  });

  it('stops drawing an event once it is over or cancelled', () => {
    const now = new Date('2026-09-20T00:00:00.000Z');

    expect(activeEvents([event()], now)).toEqual([]);
    expect(
      activeEvents([event({ endsAt: '2026-10-01T00:00:00.000Z', status: 'cancelled' })], now)
    ).toEqual([]);
  });

  it('draws an event area as a closed ring', () => {
    const features = eventFeatures([event()]);

    expect(features.features[0]!.geometry.coordinates[0]).toHaveLength(5);
    // An event frames ground; it carries no identity of its own.
    expect(Object.keys(features.features[0]!.properties)).toEqual(['eventId']);
  });
});

describe('how good a loop shape is', () => {
  it('says it in words rather than as a number nobody can read', () => {
    expect(efficiencyLabel(0.85)).toContain('a lot of ground');
    expect(efficiencyLabel(0.5)).toContain('reasonable');
    expect(efficiencyLabel(0.1)).toContain('long way round');
  });
});
