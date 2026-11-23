import type {
  QuestDetail,
  ProgressionSummary,
  Coordinate,
  GhostTraceResponse,
  TerritoryClaim,
  TerritoryClaimHistoryResponse
} from '@runsphere/contracts';
import previewGeometry from './preview-turf-geometry.json';

export const dashboardPreviewEnabled =
  typeof __DEV__ !== 'undefined' && __DEV__ && process.env.EXPO_PUBLIC_HOME_PREVIEW === 'true';

export const previewProgression: ProgressionSummary = {
  totalXp: 1240,
  questsCompleted: 6,
  achievements: [],
  weeklyConsistency: {
    periodStart: '2026-11-16',
    activeDays: 3,
    cappedActiveMinutes: 78,
    goalActiveDays: 5,
    current: true
  },
  level: { level: 4, xpInLevel: 90, nextLevelAt: 1400 }
};

/**
 * Sample quests with several stops each — places, and one stretch of route —
 * so the quest map shows numbered stops and a suggested way round them.
 */
type SampleStop =
  { title: string; at: Coordinate } | { title: string; route: readonly Coordinate[] };

export const previewTurfQuests: readonly QuestDetail[] = (
  [
    {
      id: 'sample-river',
      title: 'River Bend Run',
      start: [72.8749, 19.0746],
      distanceMeters: 2100,
      minutes: 14,
      stops: [
        { title: 'Riverside steps', at: [72.8756, 19.0755] },
        {
          title: 'Run the river path',
          route: [
            [72.8762, 19.0766],
            [72.8771, 19.0777],
            [72.8778, 19.0789]
          ]
        },
        { title: 'Footbridge', at: [72.8768, 19.0801] },
        { title: 'Banyan corner', at: [72.8744, 19.0786] }
      ]
    },
    {
      id: 'sample-kurla',
      title: 'Kurla Morning Loop',
      start: [72.8808, 19.0726],
      distanceMeters: 1800,
      minutes: 12,
      stops: [
        { title: 'Market gate', at: [72.8822, 19.0742] },
        { title: 'Temple lane', at: [72.8841, 19.0731] },
        { title: 'Station road', at: [72.8828, 19.0712] }
      ]
    },
    {
      id: 'sample-north',
      title: 'Jarimari Checkpoint',
      start: [72.8788, 19.0827],
      distanceMeters: 1600,
      minutes: 11,
      stops: [
        { title: 'Hill steps', at: [72.8779, 19.0839] },
        { title: 'Water tank', at: [72.8797, 19.0852] },
        { title: 'Lookout', at: [72.8812, 19.0838] }
      ]
    }
  ] satisfies {
    id: string;
    title: string;
    start: Coordinate;
    distanceMeters: number;
    minutes: number;
    stops: SampleStop[];
  }[]
).map(({ id, title, start, distanceMeters, minutes, stops }) => {
  const openHours = { timezone: 'Asia/Kolkata', schedule: 'Daily', status: 'open' as const };
  return {
    id,
    title,
    distanceMeters,
    estimatedActiveMinutes: minutes,
    accessibility: 'mixed',
    openHours,
    checkpointCount: stops.length,
    mapPosition: start,
    // One sample carries a time limit, to show how a timed quest reads.
    ...(id === 'sample-river' ? { timeLimitMinutes: 20 } : {}),
    sourceReviewedAt: '2026-11-01T00:00:00Z',
    checkpoints: stops.map((stop, index) => ({
      id: `${id}-stop-${index + 1}`,
      kind: 'route' in stop ? ('route' as const) : ('place' as const),
      title: stop.title,
      geometry:
        'route' in stop
          ? { type: 'LineString', coordinates: stop.route.map((p) => [...p]) }
          : { type: 'Point', coordinates: [...stop.at] },
      geometryVersion: 1,
      accessibility: 'mixed',
      openHours
    }))
  };
});

function sampleClaim(
  key: keyof typeof previewGeometry,
  displayName: string,
  longitude: number,
  latitude: number,
  isSelf: boolean,
  status: TerritoryClaim['status']
): TerritoryClaim {
  const id = `preview-${key}`;
  // This fixture is precomputed with H3 resolution 11 on Node, like the API geometry.
  const geometry = previewGeometry[key] as Pick<
    TerritoryClaim,
    'boundary' | 'heldPolygons' | 'heldCellRings' | 'areaSqm'
  >;
  return {
    ...geometry,
    id,
    owner: {
      id: `${id}-owner`,
      displayName,
      avatarKey: isSelf ? 'loop-1' : status === 'contested' ? 'rho-1' : 'orbit-04',
      isSelf
    },
    centroid: [longitude, latitude],
    distanceMetres: 1450,
    durationSeconds: 450,
    speedMps: 3.22,
    seasonMonth: '2026-11',
    captureCount: 1,
    status,
    claimedAt: new Date(Date.now() - (isSelf ? 9 : 2) * 86_400_000).toISOString()
  };
}

export const previewClaims: readonly TerritoryClaim[] = [
  sampleClaim('maya', 'Maya Chen', 72.875, 19.079, true, 'owned'),
  {
    ...sampleClaim('ravi', 'Ravi Shah', 72.8812, 19.077, false, 'owned'),
    cityTag: 'Hallow Pul',
    captureCount: 4,
    ghostAvailable: true,
    revengeAvailable: true,
    revengeLocation: [72.88118, 19.078428]
  },
  {
    ...sampleClaim('isha', 'Isha Rao', 72.878, 19.072, false, 'contested'),
    defendedCount: 3
  }
];

const rival = previewClaims[1]!;
export const previewGhostTrace: GhostTraceResponse = {
  claimId: rival.id,
  owner: rival.owner,
  points: rival.boundary.map((at, index) => ({ at, elapsedSeconds: index * 55 })),
  distanceMetres: 1110,
  durationSeconds: (rival.boundary.length - 1) * 55,
  trimMetres: 0,
  recordedOn: rival.claimedAt.slice(0, 10),
  privacyNote: 'This is a sample route for the preview.',
  rulesNote: 'Race the sample pace around Hallow Pul.',
  viewsRemaining: 2
};

export function previewClaimHistory(claim: TerritoryClaim): TerritoryClaimHistoryResponse {
  const previous = previewClaims.filter((entry) => entry.id !== claim.id);
  return {
    lineageId: claim.id,
    captureCount: claim.captureCount,
    recordSeconds: claim.durationSeconds,
    battleCount: claim.captureCount - 1 + (claim.defendedCount ?? 0),
    defendedCount: claim.defendedCount ?? 0,
    entries: Array.from({ length: claim.captureCount }, (_, index) => {
      const current = index === claim.captureCount - 1;
      return {
        claimId: current ? claim.id : `${claim.id}-holder-${index}`,
        owner: current ? claim.owner : previous[index % previous.length]!.owner,
        areaSqm: claim.areaSqm,
        durationSeconds: claim.durationSeconds + (claim.captureCount - 1 - index) * 20,
        claimedAt: new Date(
          Date.parse(claim.claimedAt) - (claim.captureCount - 1 - index) * 86_400_000
        ).toISOString(),
        ...(current
          ? {}
          : {
              releasedAt: new Date(
                Date.parse(claim.claimedAt) - (claim.captureCount - 2 - index) * 86_400_000
              ).toISOString()
            })
      };
    })
  };
}
