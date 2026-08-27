import { Type, type Static } from '@sinclair/typebox';

const UuidSchema = Type.String({ format: 'uuid' });
const Strict = { additionalProperties: false };

export const HealthResponseSchema = Type.Object(
  {
    status: Type.Literal('ok'),
    service: Type.Literal('api'),
    timestamp: Type.String({ format: 'date-time' })
  },
  { $id: 'HealthResponse' }
);

export const QuestSummarySchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    title: Type.String({ minLength: 1 }),
    distanceKm: Type.Number({ exclusiveMinimum: 0 }),
    durationMinutes: Type.Integer({ minimum: 1 }),
    rewardXp: Type.Integer({ minimum: 0 }),
    accessibility: Type.Union([Type.Literal('step-free'), Type.Literal('mixed')])
  },
  { $id: 'QuestSummary' }
);
export const QuestListResponseSchema = Type.Object(
  { data: Type.Array(QuestSummarySchema) },
  { $id: 'QuestListResponse' }
);
export const QuestParamsSchema = Type.Object(
  { questId: Type.String({ minLength: 1 }) },
  { $id: 'QuestParams' }
);
export const QuestNotFoundResponseSchema = Type.Object(
  { message: Type.Literal('Quest not found') },
  { $id: 'QuestNotFoundResponse' }
);

export const ErrorResponseSchema = Type.Object(
  { message: Type.String() },
  { $id: 'ErrorResponse' }
);
export const RegisterRequestSchema = Type.Object(
  {
    email: Type.String({ format: 'email', maxLength: 320 }),
    password: Type.String({ minLength: 12, maxLength: 256 }),
    ageAssertion: Type.Literal(true),
    policyVersion: Type.String({ minLength: 1, maxLength: 64 })
  },
  { ...Strict, $id: 'RegisterRequest' }
);
export const LoginRequestSchema = Type.Object(
  {
    email: Type.String({ format: 'email', maxLength: 320 }),
    password: Type.String({ minLength: 1, maxLength: 256 })
  },
  { ...Strict, $id: 'LoginRequest' }
);
export const RefreshRequestSchema = Type.Object(
  { refreshToken: Type.String({ minLength: 32, maxLength: 1024 }) },
  { ...Strict, $id: 'RefreshRequest' }
);
export const LogoutRequestSchema = RefreshRequestSchema;
export const AuthResponseSchema = Type.Object(
  {
    accessToken: Type.String(),
    refreshToken: Type.String(),
    expiresInSeconds: Type.Integer({ minimum: 1 })
  },
  { $id: 'AuthResponse' }
);
const CoordinateSchema = Type.Array(Type.Number(), { minItems: 2, maxItems: 2 });
const GeoJsonPointSchema = Type.Object(
  { type: Type.Literal('Point'), coordinates: CoordinateSchema },
  Strict
);
const GeoJsonPolygonSchema = Type.Object(
  {
    type: Type.Literal('Polygon'),
    coordinates: Type.Array(Type.Array(CoordinateSchema, { minItems: 4, maxItems: 1000 }), {
      minItems: 1,
      maxItems: 50
    })
  },
  Strict
);
export const PrivacyZoneRequestSchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 80 }),
    geometry: Type.Union([GeoJsonPointSchema, GeoJsonPolygonSchema])
  },
  { ...Strict, $id: 'PrivacyZoneRequest' }
);
export const PrivacyZoneResponseSchema = Type.Object(
  {
    id: UuidSchema,
    name: Type.String(),
    geometry: Type.Unknown(),
    geometryVersion: Type.Integer({ minimum: 1 })
  },
  { $id: 'PrivacyZoneResponse' }
);
export const ActivityParamsSchema = Type.Object(
  { activityId: UuidSchema },
  { ...Strict, $id: 'ActivityParams' }
);
export const ActivityCreateRequestSchema = Type.Object(
  { movementType: Type.Union([Type.Literal('walk'), Type.Literal('run'), Type.Literal('hike')]) },
  { ...Strict, $id: 'ActivityCreateRequest' }
);
const PointSchema = Type.Object(
  {
    latitude: Type.Number({ minimum: -90, maximum: 90 }),
    longitude: Type.Number({ minimum: -180, maximum: 180 }),
    recordedAt: Type.String({ format: 'date-time' }),
    accuracyMeters: Type.Optional(Type.Number({ minimum: 0, maximum: 10000 }))
  },
  Strict
);
export const ActivityChunkRequestSchema = Type.Object(
  {
    sequence: Type.Integer({ minimum: 0 }),
    points: Type.Array(PointSchema, { minItems: 1, maxItems: 500 })
  },
  { ...Strict, $id: 'ActivityChunkRequest' }
);
export const ActivityFinalizeRequestSchema = Type.Object(
  { expectedChunkCount: Type.Integer({ minimum: 1, maximum: 10000 }) },
  { ...Strict, $id: 'ActivityFinalizeRequest' }
);
export const ActivityStatusResponseSchema = Type.Object(
  {
    id: UuidSchema,
    status: Type.Union([
      Type.Literal('received'),
      Type.Literal('validating'),
      Type.Literal('accepted'),
      Type.Literal('rejected'),
      Type.Literal('derived')
    ]),
    summary: Type.Optional(
      Type.Object(
        {
          distanceMeters: Type.Number({ minimum: 0 }),
          durationSeconds: Type.Number({ minimum: 0 }),
          pointCount: Type.Integer({ minimum: 0 }),
          privacyTrimmed: Type.Boolean()
        },
        Strict
      )
    ),
    rejectionReason: Type.Optional(Type.String())
  },
  { $id: 'ActivityStatusResponse' }
);

export type HealthResponse = Static<typeof HealthResponseSchema>;
export type QuestSummary = Static<typeof QuestSummarySchema>;
export type QuestParams = Static<typeof QuestParamsSchema>;
export type RegisterRequest = Static<typeof RegisterRequestSchema>;
export type LoginRequest = Static<typeof LoginRequestSchema>;
export type RefreshRequest = Static<typeof RefreshRequestSchema>;
export type PrivacyZoneRequest = Static<typeof PrivacyZoneRequestSchema>;
export type ActivityCreateRequest = Static<typeof ActivityCreateRequestSchema>;
export type ActivityChunkRequest = Static<typeof ActivityChunkRequestSchema>;
export type ActivityFinalizeRequest = Static<typeof ActivityFinalizeRequestSchema>;
