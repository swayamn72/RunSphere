import { describe, expect, it } from 'vitest';
import {
  OWNER_VIEW,
  TRIM_START_FINISH_METRES,
  decodeCursor,
  runLogViewFor
} from './run-log-routes.js';

const settings = {
  runs_visibility: 'friends' as const,
  show_route_maps: true,
  show_start_times: false,
  trim_start_finish: false
};

describe('runLogViewFor (M9 9.14, ADR-0015)', () => {
  it('shows you all of your own runs, whatever your settings', () => {
    expect(runLogViewFor('self', { ...settings, runs_visibility: 'only_me' })).toBe(OWNER_VIEW);
  });

  it('by default shows friends the route untrimmed and the date only, and nobody else', () => {
    expect(runLogViewFor('friend', settings)).toEqual({
      showStartTimes: false,
      showRoute: true,
      trimEndsMetres: 0
    });
    for (const relationship of ['none', 'request_sent', 'request_received'] as const)
      expect(runLogViewFor(relationship, settings)).toBe('hidden');
  });

  it('follows everyone, only me, route maps, start times and the trim', () => {
    expect(runLogViewFor('none', { ...settings, runs_visibility: 'everyone' })).not.toBe('hidden');
    expect(runLogViewFor('friend', { ...settings, runs_visibility: 'only_me' })).toBe('hidden');
    expect(
      runLogViewFor('friend', {
        ...settings,
        show_route_maps: false,
        show_start_times: true,
        trim_start_finish: true
      })
    ).toEqual({ showStartTimes: true, showRoute: false, trimEndsMetres: TRIM_START_FINISH_METRES });
  });
});

describe('decodeCursor', () => {
  it('reads back only well-formed cursors', () => {
    const cursor = Buffer.from(
      JSON.stringify(['2026-11-01T00:30:00.000Z', '00000000-0000-4000-8000-000000000001'])
    ).toString('base64url');
    expect(decodeCursor(cursor)).toEqual({
      createdAt: '2026-11-01T00:30:00.000Z',
      id: '00000000-0000-4000-8000-000000000001'
    });
    expect(decodeCursor('nope')).toBeUndefined();
    expect(decodeCursor(Buffer.from('["x","y"]').toString('base64url'))).toBeUndefined();
  });
});
