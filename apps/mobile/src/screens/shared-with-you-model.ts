import type { SafetyShareReadResponse, SafetyShareReceived } from '@runsphere/contracts';
import { ApiFailure } from '../api-client';
import { failureMessage } from '../failure-copy';

/**
 * Safety shares sent to you (M3.6). The server keeps only 500 m tiles,
 * released 15 minutes late; this turns the newest one back into the centre of
 * its tile, which is as precise as a share ever gets.
 *
 * The inverse of `coarseTile` in the API's safety routes: equirectangular
 * tiles, rows by latitude, columns scaled by the cosine of the latitude.
 */
const METRES_PER_DEGREE_LAT = 110_574;
const METRES_PER_DEGREE_LNG = 111_320;

export const tileCentre = (
  tileX: number,
  tileY: number,
  tileSizeMeters: number
): { latitude: number; longitude: number } => {
  const latitude = ((tileY + 0.5) * tileSizeMeters) / METRES_PER_DEGREE_LAT;
  const scale = Math.max(Math.cos((latitude * Math.PI) / 180), 0.01);
  const longitude = ((tileX + 0.5) * tileSizeMeters) / (METRES_PER_DEGREE_LNG * scale);
  return { latitude, longitude };
};

/** A maps-app link to the approximate area, labelled so it never reads as exact. */
export const approximateAreaUrl = (centre: { latitude: number; longitude: number }): string => {
  const lat = centre.latitude.toFixed(4);
  const lng = centre.longitude.toFixed(4);
  return `geo:${lat},${lng}?q=${lat},${lng}(Approximate area)`;
};

const clock = (iso: string): string => {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

export const sharedRowLabel = (share: SafetyShareReceived): { title: string; detail: string } => ({
  title: `${share.sharerDisplayName} is sharing with you`,
  detail: `@${share.sharerUsername} · until ${clock(share.expiresAt)}`
});

export type LatestUpdate =
  | { readonly kind: 'none'; readonly message: string }
  | {
      readonly kind: 'seen';
      readonly message: string;
      readonly centre: { latitude: number; longitude: number };
    };

export const latestUpdate = (read: SafetyShareReadResponse): LatestUpdate => {
  const newest = [...read.updates].sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0];
  if (!newest)
    return {
      kind: 'none',
      message: `Nothing yet. Updates show up ${read.delayMinutes} minutes after they happen.`
    };
  return {
    kind: 'seen',
    message: `Last seen at ${clock(newest.observedAt)}, within about ${read.tileSizeMeters} m. Shown ${read.delayMinutes} minutes late.`,
    centre: tileCentre(newest.tileX, newest.tileY, read.tileSizeMeters)
  };
};

export const shareReadFailureMessage = (error: unknown): string =>
  error instanceof ApiFailure && (error.status === 403 || error.status === 404)
    ? 'This share has ended.'
    : failureMessage(error, "Couldn't check in right now. Try again.");
