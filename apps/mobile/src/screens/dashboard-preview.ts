import type { TerritoryClaim } from '@runsphere/contracts';

export const dashboardPreviewEnabled =
  typeof __DEV__ !== 'undefined' && __DEV__ && process.env.EXPO_PUBLIC_HOME_PREVIEW === 'true';

function sampleClaim(
  id: string,
  displayName: string,
  longitude: number,
  latitude: number,
  isSelf: boolean,
  status: TerritoryClaim['status']
): TerritoryClaim {
  return {
    id,
    owner: { id: `${id}-owner`, displayName, avatarKey: 'orbit-04', isSelf },
    boundary: [
      [longitude - 0.002, latitude - 0.001],
      [longitude + 0.001, latitude - 0.002],
      [longitude + 0.002, latitude + 0.001],
      [longitude - 0.001, latitude + 0.002]
    ],
    centroid: [longitude, latitude],
    areaSqm: 84_000,
    distanceMetres: 1450,
    durationSeconds: 450,
    speedMps: 3.22,
    seasonMonth: '2026-11',
    captureCount: 1,
    status,
    claimedAt: '2026-11-19T05:10:00.000Z'
  };
}

export const previewClaims = [
  sampleClaim('preview-maya', 'Maya Chen', 72.875, 19.079, true, 'owned'),
  sampleClaim('preview-ravi', 'Ravi Shah', 72.882, 19.077, false, 'owned'),
  sampleClaim('preview-isha', 'Isha Rao', 72.878, 19.072, false, 'contested')
];
