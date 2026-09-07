import { useMemo } from 'react';
import type { FeatureCollection, GeoJsonProperties, Geometry, Position } from 'geojson';
import { GeoJSONSource, Layer } from '@maplibre/maplibre-react-native';
import type { SemanticTokens } from '@runsphere/ui';
import { decimateCoordinates } from './map-model';

export interface LocalGeoJsonLayer {
  readonly id: string;
  readonly data: FeatureCollection<Geometry, GeoJsonProperties>;
  /**
   * `fill` draws held territory cells (milestone 4.5). A cell is a shape and
   * nothing else — it carries no holder, so it is painted one way whether it is
   * the reader's or somebody else's, distinguished only by opacity.
   *
   * `guide` draws an accepted route suggestion (`map-ux.md` section 1.5). It is
   * deliberately a different style from `line`: the solid lime trace is where
   * the runner *has been*, and a guide is a reference they are free to ignore.
   * Painting the two alike would turn a suggestion into an instruction.
   *
   * `ghost` draws how far the holder had got by now (`screens.md` LR.1), and
   * `ghost-head` marks where they are. A third distinct style, because a live
   * screen can carry all three at once — your trace, the route you accepted,
   * and somebody else's run — and three lines a runner cannot tell apart at a
   * glance is worse than two.
   */
  readonly kind: 'line' | 'circle' | 'fill' | 'guide' | 'ghost' | 'ghost-head';
}

const decimateGeometry = (geometry: Geometry): Geometry => {
  if (geometry.type === 'LineString') {
    return { ...geometry, coordinates: [...decimateCoordinates<Position>(geometry.coordinates)] };
  }
  if (geometry.type === 'MultiLineString') {
    return {
      ...geometry,
      coordinates: geometry.coordinates.map((line) => [...decimateCoordinates<Position>(line)])
    };
  }
  return geometry;
};

/** Keeps source data local to the renderer while bounding large route render work. */
export const createRendererLocalGeoJson = (
  data: FeatureCollection<Geometry, GeoJsonProperties>
): FeatureCollection<Geometry, GeoJsonProperties> => ({
  ...data,
  features: data.features.map((feature) =>
    feature.geometry ? { ...feature, geometry: decimateGeometry(feature.geometry) } : feature
  )
});

/**
 * App GeoJSON is passed directly to the native renderer. It is never converted
 * into a provider URL, query parameter, request header, analytics payload, or log.
 */
export function LocalGeoJsonLayers({
  layers,
  tokens
}: {
  layers: readonly LocalGeoJsonLayer[];
  tokens: SemanticTokens;
}) {
  const rendererLayers = useMemo(
    () => layers.map((layer) => ({ ...layer, data: createRendererLocalGeoJson(layer.data) })),
    [layers]
  );

  return (
    <>
      {rendererLayers.map((layer) => (
        <GeoJSONSource key={layer.id} id={`${layer.id}-source`} data={layer.data}>
          {layer.kind === 'fill' ? (
            <Layer
              id={`${layer.id}-layer`}
              type="fill"
              paint={{
                'fill-color': tokens.route.fill,
                'fill-outline-color': tokens.route.line,
                // The reader's own cells read stronger than the rest. Nothing
                // else separates them, because nothing else may be shown.
                'fill-opacity': ['case', ['get', 'isSelf'], 0.55, 0.25]
              }}
            />
          ) : layer.kind === 'line' ? (
            <Layer
              id={`${layer.id}-layer`}
              type="line"
              paint={{
                'line-color': tokens.route.line,
                'line-width': 5,
                'line-opacity': 0.92
              }}
            />
          ) : layer.kind === 'ghost' ? (
            // Cool and solid against a lime trace and a white dashed guide:
            // colour, not pattern, is what separates it, because the ghost line
            // moves and a moving dash reads as a rendering fault.
            <Layer
              id={`${layer.id}-layer`}
              type="line"
              paint={{
                'line-color': tokens.status.info,
                'line-width': 4,
                'line-opacity': 0.8
              }}
            />
          ) : layer.kind === 'ghost-head' ? (
            // Where the holder had got to. Translucent on purpose: it is a
            // record of somebody else's run, not another runner on the road.
            <Layer
              id={`${layer.id}-layer`}
              type="circle"
              paint={{
                'circle-color': tokens.status.info,
                'circle-radius': 7,
                'circle-opacity': 0.75,
                'circle-stroke-color': tokens.checkpoint.outline,
                'circle-stroke-width': 2,
                'circle-stroke-opacity': 0.9
              }}
            />
          ) : layer.kind === 'guide' ? (
            // Thinner, dashed, half-opacity, and white rather than lime, so a
            // glance tells the two lines apart without a legend.
            <Layer
              id={`${layer.id}-layer`}
              type="line"
              paint={{
                'line-color': tokens.checkpoint.outline,
                'line-width': 3,
                'line-opacity': 0.5,
                'line-dasharray': [2, 2]
              }}
            />
          ) : (
            <Layer
              id={`${layer.id}-layer`}
              type="circle"
              paint={{
                'circle-color': tokens.checkpoint.fill,
                'circle-radius': 8,
                'circle-stroke-color': tokens.checkpoint.outline,
                'circle-stroke-width': 2
              }}
            />
          )}
        </GeoJSONSource>
      ))}
    </>
  );
}
