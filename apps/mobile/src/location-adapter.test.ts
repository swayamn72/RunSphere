import { describe, expect, it } from 'vitest';
import { parseSyntheticNdjson } from './location-adapter-core.js';
describe('synthetic location fixture seam', () => {
  it('accepts deterministic NDJSON and rejects malformed fixture records', () => {
    expect(
      parseSyntheticNdjson(
        '{"recordedAt":"2026-08-28T06:00:00Z","latitude":19.076,"longitude":72.877,"accuracy":8}\n'
      )
    ).toEqual([
      {
        recordedAt: '2026-08-28T06:00:00Z',
        latitude: 19.076,
        longitude: 72.877,
        accuracy: 8,
        altitude: null
      }
    ]);
    expect(() => parseSyntheticNdjson('{"latitude":19}\n')).toThrow('synthetic location fixture');
  });
});
