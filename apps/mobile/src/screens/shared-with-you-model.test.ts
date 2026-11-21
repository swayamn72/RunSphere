import { describe, expect, it } from 'vitest';
import { ApiFailure } from '../api-client';
import {
  approximateAreaUrl,
  latestUpdate,
  shareReadFailureMessage,
  sharedRowLabel,
  tileCentre
} from './shared-with-you-model';

/** The API's tile formula (`coarseTile` in safety-routes), copied to prove the inverse. */
const coarseTile = (latitude: number, longitude: number) => ({
  x: Math.floor((longitude * 111_320 * Math.max(Math.cos((latitude * Math.PI) / 180), 0.01)) / 500),
  y: Math.floor((latitude * 110_574) / 500)
});

describe('safety shares sent to you (M3.6)', () => {
  it('turns a tile back into a point inside the same 500 m tile', () => {
    for (const [lat, lng] of [
      [19.0437, 72.8194],
      [18.9, 72.83],
      [51.5, -0.12]
    ] as const) {
      const tile = coarseTile(lat, lng);
      const centre = tileCentre(tile.x, tile.y, 500);
      expect(coarseTile(centre.latitude, centre.longitude)).toEqual(tile);
    }
  });

  it('labels the maps link as an approximate area', () => {
    expect(approximateAreaUrl({ latitude: 19.04371, longitude: 72.81942 })).toBe(
      'geo:19.0437,72.8194?q=19.0437,72.8194(Approximate area)'
    );
  });

  it('says how delayed and how coarse the newest update is', () => {
    const tile = coarseTile(19.0437, 72.8194);
    const seen = latestUpdate({
      status: 'active',
      delayMinutes: 15,
      tileSizeMeters: 500,
      updates: [
        { tileX: tile.x - 1, tileY: tile.y, observedAt: '2026-11-21T06:00:00.000Z' },
        { tileX: tile.x, tileY: tile.y, observedAt: '2026-11-21T06:10:00.000Z' }
      ]
    });
    expect(seen.kind).toBe('seen');
    expect(seen.message).toMatch(/within about 500 m\. Shown 15 minutes late\./);
    if (seen.kind === 'seen')
      expect(coarseTile(seen.centre.latitude, seen.centre.longitude)).toEqual(tile);

    const none = latestUpdate({
      status: 'active',
      delayMinutes: 15,
      tileSizeMeters: 500,
      updates: []
    });
    expect(none).toEqual({
      kind: 'none',
      message: 'Nothing yet. Updates show up 15 minutes after they happen.'
    });
  });

  it('names who is sharing and says an ended share has ended', () => {
    expect(
      sharedRowLabel({
        id: '00000000-0000-4000-8000-000000000001',
        sharerDisplayName: 'Maya',
        sharerUsername: 'maya_runs',
        startedAt: '2026-11-21T05:00:00.000Z',
        expiresAt: '2026-11-21T06:00:00.000Z'
      }).title
    ).toBe('Maya is sharing with you');
    expect(shareReadFailureMessage(new ApiFailure(403, 'not active'))).toBe(
      'This share has ended.'
    );
  });
});
