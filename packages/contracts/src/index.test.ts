import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { activityFinalizeChecksumInput, canonicalJson } from './index.js';

describe('activity sync canonicalization', () => {
  it('sorts object keys without changing array order', () => {
    expect(canonicalJson({ points: [{ longitude: 72.8, latitude: 19.0 }], sequence: 2 })).toBe(
      '{"points":[{"latitude":19,"longitude":72.8}],"sequence":2}'
    );
  });

  it('creates the same finalize checksum input regardless of upload order', () => {
    const input = activityFinalizeChecksumInput([
      { sequence: 2, checksum: 'c'.repeat(64) },
      { sequence: 0, checksum: 'a'.repeat(64) },
      { sequence: 1, checksum: 'b'.repeat(64) }
    ]);
    expect(input).toBe(`${'a'.repeat(64)}${'b'.repeat(64)}${'c'.repeat(64)}`);
    expect(createHash('sha256').update(input).digest('hex')).toHaveLength(64);
  });
});
