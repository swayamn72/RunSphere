import { describe, expect, it } from 'vitest';
import { ApiFailure } from './api-client';
import { AuthFailure } from './auth-failure';
import { FAILURE_COPY, failureMessage } from './failure-copy';

describe('failure copy (UX.7)', () => {
  it('has one plain message per non-state, each saying what to do or that nothing was lost', () => {
    for (const message of Object.values(FAILURE_COPY)) {
      expect(message).toMatch(
        /try again|sign in|wait|saved|refresh|keep running|start a free run|still run/i
      );
      expect(message).not.toMatch(/\d{3}|server|error|failed/i);
    }
  });

  it('maps offline, signed out, busy and unavailable to their messages', () => {
    expect(failureMessage(new AuthFailure('network'))).toBe(FAILURE_COPY.offline);
    expect(failureMessage(new TypeError('Network request failed'))).toBe(FAILURE_COPY.offline);
    expect(failureMessage(new ApiFailure(401, 'Unauthorized'))).toBe(FAILURE_COPY.sessionEnded);
    expect(failureMessage(new ApiFailure(429, 'Too many requests'))).toBe(FAILURE_COPY.rateLimited);
    expect(failureMessage(new ApiFailure(503, 'x'))).toBe(FAILURE_COPY.unavailable);
    expect(failureMessage(new ApiFailure(404, 'x'))).toBe(FAILURE_COPY.notFound);
  });

  it('never shows status codes, request paths or schema text', () => {
    const leaks = [
      new ApiFailure(500, 'Request to /v1/safety/zones failed (500).'),
      new ApiFailure(400, 'body/lengthDays must be equal to constant'),
      new ApiFailure(422, 'Request to /v1/clubs failed (422).'),
      new Error('TypeError: undefined is not an object')
    ];
    for (const error of leaks) {
      const message = failureMessage(error, 'Could not save. Try again.');
      expect(message).not.toMatch(/\/v1\/|\(\d{3}\)|body\/|undefined/);
    }
  });

  it('keeps a message the API wrote for people, such as a moderation decision', () => {
    expect(
      failureMessage(new ApiFailure(403, 'Posting is paused on this account until 3 Dec.'))
    ).toBe('Posting is paused on this account until 3 Dec.');
  });

  it('uses the caller’s fallback for anything it cannot place', () => {
    expect(failureMessage(new Error('boom'), 'Could not save the zone. Try again.')).toBe(
      'Could not save the zone. Try again.'
    );
  });
});

describe('screens never show raw error text (UX.7)', () => {
  it('has no `error instanceof Error ? error.message` shortcut in a screen', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const dir = join(__dirname, 'screens');
    const offenders = readdirSync(dir)
      .filter((file) => /\.tsx?$/.test(file) && !/\.test\./.test(file))
      .filter((file) =>
        /instanceof Error\s*\?\s*\w+\.message/.test(readFileSync(join(dir, file), 'utf8'))
      );
    expect(offenders).toEqual([]);
  });
});
