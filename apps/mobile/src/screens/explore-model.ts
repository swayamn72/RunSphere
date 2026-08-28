import type { FeatureCollection, GeoJsonProperties, Geometry, Position } from 'geojson';
import type { QuestDetail, QuestSummary } from '@runsphere/contracts';
import { AuthFailure } from '../auth-failure';
import { ApiFailure } from '../api-client';
import type { LocalGeoJsonLayer } from '../maps/LocalGeoJsonLayers';

export type QuestCatalogState =
  'loading' | 'ready' | 'empty' | 'offline' | 'error' | 'configuration' | 'session-expired';
export type QuestDetailState = 'loading' | 'ready' | 'offline' | 'error' | 'unavailable' | 'closed';
export type QuestOpenFilter = 'all' | 'open' | 'limited' | 'closed';
export type QuestAccessibilityFilter = 'all' | QuestSummary['accessibility'];
export type QuestTimeFilter = 'all' | 'under-30' | '30-to-60' | 'over-60';

export interface QuestFilters {
  readonly open: QuestOpenFilter;
  readonly accessibility: QuestAccessibilityFilter;
  readonly time: QuestTimeFilter;
}

export const initialQuestFilters: QuestFilters = { open: 'all', accessibility: 'all', time: 'all' };
export const catalogStateFor = (quests: readonly QuestSummary[]): QuestCatalogState =>
  quests.length ? 'ready' : 'empty';

export const catalogErrorStateFor = (
  error: unknown
): Extract<QuestCatalogState, 'offline' | 'error' | 'configuration' | 'session-expired'> => {
  if (!(error instanceof AuthFailure)) return 'error';
  if (error.kind === 'network' || error.kind === 'tls') return 'offline';
  if (error.kind === 'configuration') return 'configuration';
  if (error.kind === 'invalid-credentials') return 'session-expired';
  return 'error';
};

/** Filters only public QuestSummary fields—never location, geometry, rewards, scoring, or sorting. */
export const filterQuests = (
  quests: readonly QuestSummary[],
  filters: QuestFilters
): readonly QuestSummary[] =>
  quests.filter(
    (quest) =>
      (filters.open === 'all' || quest.openHours.status === filters.open) &&
      (filters.accessibility === 'all' || quest.accessibility === filters.accessibility) &&
      (filters.time === 'all' ||
        (filters.time === 'under-30' && quest.estimatedActiveMinutes < 30) ||
        (filters.time === '30-to-60' &&
          quest.estimatedActiveMinutes >= 30 &&
          quest.estimatedActiveMinutes <= 60) ||
        (filters.time === 'over-60' && quest.estimatedActiveMinutes > 60))
  );

/** Errors must take precedence over a stale summary's closed status. */
export const detailStateFor = (
  summary: QuestSummary,
  detail: QuestDetail | undefined,
  error: unknown
): QuestDetailState => {
  if (error instanceof AuthFailure && (error.kind === 'network' || error.kind === 'tls'))
    return 'offline';
  if (error instanceof ApiFailure && error.status === 404) return 'unavailable';
  if (error) return 'error';
  if (summary.openHours.status === 'closed' || detail?.openHours.status === 'closed')
    return 'closed';
  return detail ? 'ready' : 'loading';
};

const isGeometry = (value: unknown): value is Geometry =>
  Boolean(
    value &&
    typeof value === 'object' &&
    'type' in value &&
    [
      'Point',
      'MultiPoint',
      'LineString',
      'MultiLineString',
      'Polygon',
      'MultiPolygon',
      'GeometryCollection'
    ].includes(String(value.type))
  );

const collection = (features: FeatureCollection<Geometry, GeoJsonProperties>['features']) => ({
  type: 'FeatureCollection' as const,
  features
});

/** Converts selected detail geometry only into local renderer data; it performs no route evaluation. */
export const selectedCheckpointLayers = (
  detail: QuestDetail | undefined
): readonly LocalGeoJsonLayer[] => {
  if (!detail) return [];
  const features = detail.checkpoints
    .filter((checkpoint) => isGeometry(checkpoint.geometry))
    .map((checkpoint) => ({
      type: 'Feature' as const,
      properties: { checkpointId: checkpoint.id },
      geometry: checkpoint.geometry as Geometry
    }));
  const linear = features.filter(
    (feature) => !['Point', 'MultiPoint'].includes(feature.geometry.type)
  );
  const points = features.filter((feature) =>
    ['Point', 'MultiPoint'].includes(feature.geometry.type)
  );
  return [
    ...(linear.length
      ? [{ id: 'selected-checkpoint-geometry', kind: 'line' as const, data: collection(linear) }]
      : []),
    ...(points.length
      ? [{ id: 'selected-checkpoints', kind: 'circle' as const, data: collection(points) }]
      : [])
  ];
};

const firstPosition = (geometry: Geometry): Position | undefined => {
  switch (geometry.type) {
    case 'Point':
      return geometry.coordinates;
    case 'MultiPoint':
    case 'LineString':
      return geometry.coordinates[0];
    case 'MultiLineString':
    case 'Polygon':
      return geometry.coordinates[0]?.[0];
    case 'MultiPolygon':
      return geometry.coordinates[0]?.[0]?.[0];
    case 'GeometryCollection':
      return geometry.geometries.map(firstPosition).find(Boolean);
  }
};

/** Picks an initial display center from the first published geometry coordinate without evaluating a path. */
export const selectedDetailInitialCenter = (
  detail: QuestDetail | undefined
): [number, number] | undefined => {
  const position = detail?.checkpoints
    .map((checkpoint) =>
      isGeometry(checkpoint.geometry) ? firstPosition(checkpoint.geometry) : undefined
    )
    .find((candidate): candidate is Position => Boolean(candidate));
  return position && position.length >= 2 ? [position[0]!, position[1]!] : undefined;
};

export const shouldDrawSelectedGeometry = (state: QuestDetailState): boolean =>
  state === 'ready' || state === 'closed';

export interface CatalogRequestPlan {
  readonly generation: number;
  readonly active: boolean;
}
export const nextCatalogRequestPlan = (generation: number): CatalogRequestPlan => ({
  generation: generation + 1,
  active: true
});
export const acceptsCatalogResponse = (plan: CatalogRequestPlan, generation: number): boolean =>
  plan.active && plan.generation === generation;
