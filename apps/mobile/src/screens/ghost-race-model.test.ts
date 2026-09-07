import { describe, expect, it } from 'vitest';
import type { GhostTraceResponse } from '@runsphere/contracts';
import { ApiFailure } from '../api-client';
import { AuthFailure } from '../auth-failure';
import {
  GHOST_REFUSAL_MESSAGE,
  GHOST_TRIM_SUMMARY,
  ghostCard,
  ghostConfirmation,
  ghostErrorState,
  ghostLayers,
  ghostPreviewLayers,
  ghostRunFrom,
  ghostStateMessage,
  ghostTraceFromResponse
} from './ghost-race-model.js';

const BASE_LAT = 19.028;
const BASE_LNG = 72.838;
/** The same sphere the domain measures on, so 120 m steps really are 120 m. */
const METRES_PER_DEGREE = (6_378_137 * Math.PI) / 180;

/**
 * Nine points 120 m apart heading north, 20 s apart: 960 m in 160 s, 6 m/s.
 *
 * Long enough that a runner can be genuinely ahead of the ghost without
 * having covered the whole route — with a shorter fixture every "ahead" case
 * collapses into `ghost_finished`.
 */
const response = (overrides: Partial<GhostTraceResponse> = {}): GhostTraceResponse => ({
  claimId: '11111111-1111-4111-8111-111111111111',
  owner: {
    id: '22222222-2222-4222-8222-222222222222',
    displayName: 'Mira',
    avatarKey: 'orbit-01',
    isSelf: false
  },
  points: Array.from({ length: 9 }, (_unused, index) => ({
    at: [BASE_LNG, BASE_LAT + (index * 120) / METRES_PER_DEGREE] as [number, number],
    elapsedSeconds: index * 20
  })),
  distanceMetres: 960,
  durationSeconds: 160,
  trimMetres: 200,
  recordedOn: '2026-09-04',
  privacyNote: 'The route is trimmed by 200 m at both ends.',
  rulesNote: 'A ghost changes nothing about the contest.',
  viewsRemaining: 2,
  ...overrides
});

const run = ghostRunFrom(response());

describe('reading the wire format', () => {
  it('turns longitude-first coordinates into the domain shape', () => {
    const trace = ghostTraceFromResponse(response());

    // `at` is [longitude, latitude]. Swapped, Mumbai lands in Somalia.
    expect(trace.points[0]?.longitude).toBeCloseTo(BASE_LNG, 9);
    expect(trace.points[0]?.latitude).toBeCloseTo(BASE_LAT, 9);
    expect(trace.durationSeconds).toBe(160);
  });

  it('carries the notes into the run rather than re-deriving them', () => {
    // Somebody who accepted a ghost after reading what was trimmed should see
    // the same sentence mid-run, not whatever the current build says.
    expect(run.privacyNote).toBe('The route is trimmed by 200 m at both ends.');
    expect(run.rulesNote).toBe('A ghost changes nothing about the contest.');
    expect(run.holderName).toBe('Mira');
  });
});

describe('the ghost on the map', () => {
  it('draws only the part the holder had covered by now', () => {
    // 30 s in, the ghost has passed the 0 s and 20 s points and is halfway to
    // the 40 s one. Three vertices: the two it passed, plus its own position.
    const [line, head] = ghostLayers(run, 30);

    expect(line?.kind).toBe('ghost');
    expect(head?.kind).toBe('ghost-head');
    const geometry = line!.data.features[0]!.geometry as { coordinates: number[][] };
    expect(geometry.coordinates).toHaveLength(3);
  });

  it('ends the line where the ghost actually is, not at the last point passed', () => {
    const [line] = ghostLayers(run, 30);
    const coordinates = (line!.data.features[0]!.geometry as { coordinates: number[][] })
      .coordinates;

    // 30 s sits halfway between the 20 s point (120 m) and the 40 s one
    // (240 m), so the head is at 180 m — not back at 120 m.
    expect(coordinates.at(-1)?.[1]).toBeCloseTo(BASE_LAT + 180 / METRES_PER_DEGREE, 9);
  });

  it('shows only the head before the ghost has moved', () => {
    // A one-point line is not a line, and MapLibre would refuse it.
    const layers = ghostLayers(run, 0);

    expect(layers).toHaveLength(1);
    expect(layers[0]?.kind).toBe('ghost-head');
  });

  it('draws nothing when no ghost is being raced', () => {
    expect(ghostLayers(undefined, 120)).toEqual([]);
  });

  it('draws the whole route on the confirmation preview', () => {
    // The preview is a decision aid, so it shows all of it rather than
    // advancing: nothing has started yet.
    const [preview] = ghostPreviewLayers(run);
    const geometry = preview!.data.features[0]!.geometry as { coordinates: number[][] };

    expect(preview?.kind).toBe('ghost');
    expect(geometry.coordinates).toHaveLength(9);
  });
});

describe('the live comparison card', () => {
  it('labels the second number as the ghost reaching here, not as a clock', () => {
    // `screens.md` writes "You: 4:12 elapsed  Ghost: 4:31 elapsed", which reads
    // as two clocks. Both clocks started together and read the same; what
    // differs is how long the ghost took to reach where the runner is.
    const card = ghostCard(run, 60, 480);

    expect(card.detail).toContain('Mira reached here in');
    expect(card.detail).not.toContain('elapsed');
  });

  it('turns ahead, level and behind into the status colours', () => {
    // 60 s in the ghost has covered 360 m.
    expect(ghostCard(run, 60, 480).tone).toBe('success');
    expect(ghostCard(run, 60, 360).tone).toBe('warning');
    expect(ghostCard(run, 60, 240).tone).toBe('error');
  });

  it('says the route is done rather than growing a lead forever', () => {
    const card = ghostCard(run, 90, 1_200);

    expect(card.standing).toBe('ghost_finished');
    expect(card.detail).toContain('Mira finished this route in 2:40.');
  });

  it('reads as one sentence to a screen reader', () => {
    const card = ghostCard(run, 60, 480);

    expect(card.accessibilityLabel).toBe(`${card.headline} ${card.detail}`);
  });

  it('never prints a raw second count without units', () => {
    for (const distance of [0, 120, 360, 480, 1_200]) {
      const card = ghostCard(run, 60, distance);
      expect(card.headline).toMatch(/second|Level|whole ghost route/);
    }
  });
});

describe('what the confirmation says', () => {
  it('names the holder, the distance, and the time', () => {
    const confirmation = ghostConfirmation(response());

    expect(confirmation.title).toBe("Race Mira's ghost");
    expect(confirmation.pace).toBe('Mira covered 1.0 km of this loop in 2:40.');
  });

  it('states the date, because a three-week-old ghost is a different offer', () => {
    expect(ghostConfirmation(response()).recorded).toBe('Recorded on 2026-09-04.');
  });

  it('repeats both notes rather than summarising them', () => {
    const confirmation = ghostConfirmation(response());

    expect(confirmation.privacyNote).toContain('200 m');
    expect(confirmation.rulesNote).toContain('changes nothing');
  });

  it('says the trim in metres wherever a ghost is offered', () => {
    expect(GHOST_TRIM_SUMMARY).toBe('Trimmed by 200 m at both ends.');
  });
});

describe('when a ghost cannot be had', () => {
  it('reads a rate limit as a limit, not as a failure', () => {
    // Nothing is wrong. The run can still happen.
    expect(ghostErrorState(new ApiFailure(429, 'too many'))).toBe('rate-limited');
    expect(ghostStateMessage('rate-limited')).toContain('does not need one');
  });

  it('reads a refusal as unavailable rather than broken', () => {
    expect(ghostErrorState(new ApiFailure(403, 'own claim'))).toBe('unavailable');
    expect(ghostErrorState(new ApiFailure(404, 'not held'))).toBe('unavailable');
  });

  it('separates being offline from being broken, and both from a dead session', () => {
    expect(ghostErrorState(new AuthFailure('network'))).toBe('offline');
    expect(ghostErrorState(new AuthFailure('tls'))).toBe('offline');
    expect(ghostErrorState(new AuthFailure('invalid-credentials'))).toBe('session-expired');
    expect(ghostErrorState(new ApiFailure(500, 'boom'))).toBe('error');
    expect(ghostErrorState(new Error('boom'))).toBe('error');
  });

  it('ends every refusal with the run still being possible', () => {
    for (const state of ['unavailable', 'rate-limited', 'offline', 'error'] as const) {
      expect(ghostStateMessage(state)).toMatch(/run|need/i);
    }
  });

  it('has words for every reason the contract allows', () => {
    for (const reason of [
      'no_trace',
      'own_claim',
      'not_held',
      'out_of_region',
      'rate_limited'
    ] as const) {
      expect(GHOST_REFUSAL_MESSAGE[reason]).toMatch(/\S/);
    }
  });
});
