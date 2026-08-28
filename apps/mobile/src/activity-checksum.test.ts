import { describe, expect, it } from 'vitest';
import { aggregateChecksum, chunkChecksum } from './api-client.js';

describe('activity checksums', () => {
  it('uses sorted-key canonical JSON and stable aggregate sequence order', () => {
    const chunk = {
      sequence: 0,
      points: [
        {
          longitude: 72.8777,
          recordedAt: '2026-08-28T06:00:00.000Z',
          latitude: 19.076,
          accuracyMeters: 8
        }
      ]
    };
    expect(chunkChecksum(chunk)).toBe(
      'e51dfd4fe874c2abe051b6c9277d94af9c5ba639524d0a1622fe399310df42f1'
    );
    expect(aggregateChecksum([{ ...chunk, sequence: 1 }, chunk])).toBe(
      aggregateChecksum([chunk, { ...chunk, sequence: 1 }])
    );
  });
});
