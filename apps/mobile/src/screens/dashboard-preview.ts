import type {
  QuestDetail,
  Coordinate,
  GhostTraceResponse,
  TerritoryClaim,
  TerritoryClaimHistoryResponse
} from '@runsphere/contracts';
import previewGeometry from './preview-turf-geometry.json';

export const dashboardPreviewEnabled =
  typeof __DEV__ !== 'undefined' && __DEV__ && process.env.EXPO_PUBLIC_HOME_PREVIEW === 'true';

export const previewTurfQuests: readonly QuestDetail[] = [
  {
    id: 'sample-river',
    title: 'River Bend Run',
    route: [
      [72.8749, 19.0746],
      [72.8756, 19.0755],
      [72.876, 19.0761]
    ]
  },
  {
    id: 'sample-kurla',
    title: 'Kurla Morning Loop',
    route: [
      [72.8808, 19.0726],
      [72.8814, 19.0736],
      [72.8822, 19.0742]
    ]
  },
  {
    id: 'sample-north',
    title: 'Jarimari Checkpoint',
    route: [
      [72.8788, 19.0827],
      [72.8779, 19.0833],
      [72.8774, 19.0842]
    ]
  }
].map(({ id, title, route }) => {
  const openHours = { timezone: 'Asia/Kolkata', schedule: 'Daily', status: 'open' as const };
  return {
    id,
    title,
    distanceMeters: 1350,
    estimatedActiveMinutes: 12,
    accessibility: 'mixed',
    openHours,
    checkpointCount: 1,
    mapPosition: route[0] as Coordinate,
    sourceReviewedAt: '2026-11-01T00:00:00Z',
    checkpoints: [
      {
        id: `${id}-route`,
        kind: 'route',
        title: 'Follow the checkpoint route',
        geometry: { type: 'LineString', coordinates: route },
        geometryVersion: 1,
        accessibility: 'mixed',
        openHours
      }
    ]
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
