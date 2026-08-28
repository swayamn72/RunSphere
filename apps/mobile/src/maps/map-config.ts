export interface MapProviderConfig {
  readonly styleUrl: string;
  readonly attribution: string;
}

export type MapConfigurationResult =
  | { readonly kind: 'provider'; readonly provider: MapProviderConfig }
  | { readonly kind: 'fallback'; readonly reason: 'absent' | 'invalid' | 'rejected-origin' };

const splitOrigins = (value: string | undefined): string[] =>
  value
    ?.split(',')
    .map((origin) => origin.trim().toLowerCase())
    .filter(Boolean) ?? [];

const matchesApprovedOrigin = (styleUrl: URL, approvedOrigins: readonly string[]): boolean =>
  approvedOrigins.some((origin) => {
    try {
      const approved = new URL(origin);
      return (
        approved.protocol === 'https:' &&
        styleUrl.protocol === 'https:' &&
        approved.hostname === styleUrl.hostname &&
        approved.port === styleUrl.port
      );
    } catch {
      return false;
    }
  });

/**
 * Resolves only explicit HTTPS configuration. A missing or rejected configuration
 * deliberately returns the app-owned fallback; it never substitutes a public map.
 */
export const resolveMapProviderConfig = (
  styleUrlValue = process.env.EXPO_PUBLIC_MAP_STYLE_URL,
  approvedOriginsValue = process.env.EXPO_PUBLIC_MAP_STYLE_ORIGINS,
  attributionValue = process.env.EXPO_PUBLIC_MAP_ATTRIBUTION
): MapConfigurationResult => {
  const styleUrl = styleUrlValue?.trim();
  const approvedOrigins = splitOrigins(approvedOriginsValue);
  const attribution = attributionValue?.trim();

  if (!styleUrl || !attribution || approvedOrigins.length === 0) {
    return { kind: 'fallback', reason: 'absent' };
  }

  let parsed: URL;
  try {
    parsed = new URL(styleUrl);
  } catch {
    return { kind: 'fallback', reason: 'invalid' };
  }

  if (parsed.protocol !== 'https:') {
    return { kind: 'fallback', reason: 'invalid' };
  }
  if (!matchesApprovedOrigin(parsed, approvedOrigins)) {
    return { kind: 'fallback', reason: 'rejected-origin' };
  }

  return {
    kind: 'provider',
    provider: { styleUrl: parsed.toString(), attribution }
  };
};

/** The exact render plan used by MapSurface; it has no route, account, or activity inputs. */
export const resolveMapRenderPlan = (
  styleUrlValue?: string,
  approvedOriginsValue?: string,
  attributionValue?: string
): MapConfigurationResult =>
  resolveMapProviderConfig(styleUrlValue, approvedOriginsValue, attributionValue);

export const mapProductCopy = (state: 'offline' | 'unavailable'): string =>
  state === 'offline' ? 'Offline map view' : 'Map details unavailable';
