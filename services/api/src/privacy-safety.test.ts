import { describe, expect, it } from 'vitest';
import { coarseTile } from './app.js';

describe('privacy and safety boundaries', () => {
  it('uses non-H3 coarse tiles for delayed safety-share input', () => {
    expect(coarseTile(19.076, 72.8777)).toEqual({ x: 16225, y: 4218 });
    expect(coarseTile(19.0761, 72.8777)).toEqual(coarseTile(19.076, 72.8777));
  });
});
