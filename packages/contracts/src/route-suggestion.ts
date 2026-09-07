import { Type, type Static } from '@sinclair/typebox';
import { Strict, UuidSchema } from './common.js';
import { CoordinateSchema } from './territory-claim.js';

/**
 * Route suggestions (`product.md`; `map-ux.md` section 2).
 *
 * A suggestion is a **reviewed loop somebody published**, offered because its
 * distance is near what the runner wants and it starts near where they are.
 * `041_curated_routes.sql` explains why these are chosen rather than generated.
 *
 * What a payload here carries about the runner: nothing. The request takes a
 * coarse position and the response echoes no part of it back.
 */

/**
 * Where the runner is, coarsely.
 *
 * `product.md`: the endpoint must "accept the runner's coarse location (not
 * precise — only coarse is needed for route generation)". The server rounds
 * this further before use and stores none of it.
 */
export const RouteSuggestionQuerySchema = Type.Object(
  {
    latitude: Type.Number({ minimum: -90, maximum: 90 }),
    longitude: Type.Number({ minimum: -180, maximum: 180 }),
    /** 1-10 km. Outside that it is clamped rather than refused. */
    targetDistanceKm: Type.Optional(Type.Number({ minimum: 0.1, maximum: 100 })),
    /** "I have 30 minutes". Converted at the runner's own pace estimate. */
    targetMinutes: Type.Optional(Type.Number({ minimum: 1, maximum: 600 }))
  },
  { ...Strict, $id: 'RouteSuggestionQuery' }
);

/**
 * What a reviewed loop tells a runner before they set off.
 *
 * Surface, lighting, and traffic are here because a reviewer had to have an
 * opinion on each (`041`), and because they are what somebody deciding whether
 * to run somewhere after dark actually needs.
 */
export const RouteSuggestionSchema = Type.Object(
  {
    id: UuidSchema,
    name: Type.String({ minLength: 1, maxLength: 120 }),
    /** The loop, as drawn. Closed: the last point is the first. */
    path: Type.Array(CoordinateSchema, { minItems: 4, maxItems: 512 }),
    /** Where it begins, so the map can show how far away that is. */
    start: CoordinateSchema,
    distanceMetres: Type.Number({ minimum: 1000, maximum: 10000 }),
    /** How far the runner is from the start. */
    startDistanceMetres: Type.Number({ minimum: 0 }),
    /**
     * Estimated from the runner's own recent runs, or a published default.
     * **An estimate, never a target** — the app must present it as one.
     */
    estimatedSeconds: Type.Integer({ minimum: 1 }),
    surface: Type.Union([
      Type.Literal('paved'),
      Type.Literal('track'),
      Type.Literal('trail'),
      Type.Literal('mixed')
    ]),
    lit: Type.Boolean(),
    trafficExposure: Type.Union([
      Type.Literal('none'),
      Type.Literal('low'),
      Type.Literal('moderate')
    ]),
    accessibility: Type.Union([
      Type.Literal('step-free'),
      Type.Literal('mixed'),
      Type.Literal('unknown')
    ]),
    /** Why this one is on the list, in words. Never a claim about the runner. */
    reason: Type.String({ minLength: 1, maxLength: 300 })
  },
  { $id: 'RouteSuggestion' }
);

export const RouteSuggestionResponseSchema = Type.Object(
  {
    /** At most three (`product.md`), one per route family. */
    data: Type.Array(RouteSuggestionSchema, { maxItems: 3 }),
    /** The distance the set aimed at, so the app can show the slider position. */
    targetDistanceMetres: Type.Number({ minimum: 0 }),
    /**
     * Why that distance. `high_recent_load` is the one the app should surface
     * in words: it is the only case where the answer is deliberately shorter
     * than what the runner usually does.
     */
    targetReason: Type.Union([
      Type.Literal('you_asked_for_a_distance'),
      Type.Literal('you_asked_for_a_time'),
      Type.Literal('high_recent_load'),
      Type.Literal('your_usual_distance'),
      Type.Literal('new_runner_default')
    ]),
    /** Present when `data` is empty, with words to show. */
    unavailableReason: Type.Optional(
      Type.Union([Type.Literal('no_curated_routes'), Type.Literal('all_declined')])
    ),
    /** Said wherever a suggestion is: this is a guide, not a route to follow. */
    note: Type.String({ minLength: 1, maxLength: 400 })
  },
  { $id: 'RouteSuggestionResponse' }
);

/**
 * What the runner did about a suggestion.
 *
 * `accepted` and `declined` come from the preview screen; `completed` is
 * recorded when a run finishes against an accepted route. `shown` is written by
 * the server when it answers, not by the client — an impression the client
 * reports is an impression the client can fabricate.
 */
export const RouteSuggestionFeedbackRequestSchema = Type.Object(
  {
    action: Type.Union([
      Type.Literal('accepted'),
      Type.Literal('declined'),
      Type.Literal('completed')
    ])
  },
  { ...Strict, $id: 'RouteSuggestionFeedbackRequest' }
);

export const RouteSuggestionFeedbackResponseSchema = Type.Object(
  { recorded: Type.Boolean() },
  { $id: 'RouteSuggestionFeedbackResponse' }
);

export type RouteSuggestionQuery = Static<typeof RouteSuggestionQuerySchema>;
export type RouteSuggestion = Static<typeof RouteSuggestionSchema>;
export type RouteSuggestionResponse = Static<typeof RouteSuggestionResponseSchema>;
export type RouteSuggestionFeedbackRequest = Static<typeof RouteSuggestionFeedbackRequestSchema>;
export type RouteSuggestionFeedbackResponse = Static<typeof RouteSuggestionFeedbackResponseSchema>;
