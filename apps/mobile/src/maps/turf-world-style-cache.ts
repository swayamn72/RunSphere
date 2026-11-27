import type { StyleSpecification } from '@maplibre/maplibre-react-native';
import { resolveMapRenderPlan } from './map-config';
import { turfWorldStyle, type MapScheme } from './turf-world-style';

/**
 * The Turf world style, fetched once per app session.
 *
 * The Map tab used to fetch the provider's style.json on every visit, draw the
 * map with the provider URL first, then remount it when the restyled version
 * arrived, so each visit loaded the style and the visible tiles twice. Here the
 * provider's style is downloaded once and each variant (day or night, with or
 * without 3D buildings) is built from it on demand and kept.
 */
const provider = new Map<string, StyleSpecification>();
const variants = new Map<string, StyleSpecification>();
const pending = new Map<string, Promise<StyleSpecification | undefined>>();

export interface WorldVariant {
  scheme: MapScheme;
  buildings: boolean;
}

const variantKey = (url: string, { scheme, buildings }: WorldVariant) =>
  `${url}|${scheme}|${buildings ? '3d' : 'flat'}`;

/** True once the provider's style is in hand, so the map can be built straight away. */
export const hasTurfWorldStyle = (url: string): boolean => provider.has(url);

/** The restyled map for this theme and 3D setting, or undefined before the download lands. */
export function cachedTurfWorldStyle(
  url: string,
  variant: WorldVariant
): StyleSpecification | undefined {
  const key = variantKey(url, variant);
  const kept = variants.get(key);
  if (kept) return kept;
  const source = provider.get(url);
  const built = source
    ? turfWorldStyle(source, variant.scheme, { buildings: variant.buildings })
    : undefined;
  if (built) variants.set(key, built);
  return built;
}

const fetchProvider = (url: string): Promise<StyleSpecification | undefined> => {
  const known = provider.get(url);
  if (known) return Promise.resolve(known);
  const inFlight = pending.get(url);
  if (inFlight) return inFlight;
  const request = fetch(url)
    .then((response) =>
      response.ok ? (response.json() as Promise<StyleSpecification>) : undefined
    )
    .then((style) => {
      // Only a style the Turf world can be built from is remembered: a dropped
      // request or a bad response gets another try on the next visit.
      if (style && turfWorldStyle(style)) {
        provider.set(url, style);
        return style;
      }
      return undefined;
    })
    .catch(() => undefined)
    .finally(() => pending.delete(url));
  pending.set(url, request);
  return request;
};

export async function loadTurfWorldStyle(
  url: string,
  variant: WorldVariant
): Promise<StyleSpecification | undefined> {
  await fetchProvider(url);
  return cachedTurfWorldStyle(url, variant);
}

/** Warm the cache after sign-in so the first Map visit doesn't wait on it. */
export function prefetchTurfWorldStyle(): void {
  const plan = resolveMapRenderPlan();
  if (plan.kind === 'provider') void fetchProvider(plan.provider.styleUrl);
}

/** For tests only. */
export function resetTurfWorldStyleCache(): void {
  provider.clear();
  variants.clear();
  pending.clear();
}
