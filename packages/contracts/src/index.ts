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
export const ReadinessResponseSchema = Type.Object(
  {
    status: Type.Union([Type.Literal('ready'), Type.Literal('not_ready')]),
    service: Type.Literal('api')
  },
  { $id: 'ReadinessResponse' }
);
export const StaffReviewAuthorizationHeadersSchema = Type.Object(
  { authorization: Type.String({ pattern: '^Bearer\\s+\\S+$' }) },
  { additionalProperties: true, $id: 'StaffReviewAuthorizationHeaders' }
);
export const StaffReviewItemSchema = Type.Object(
  {
    id: UuidSchema,
    status: Type.Union([
      Type.Literal('received'),
      Type.Literal('validating'),
      Type.Literal('rejected')
    ]),
    submittedAt: Type.String({ format: 'date-time' }),
    rejectionReason: Type.Optional(Type.String()),
    validationErrors: Type.Array(Type.String({ maxLength: 160 }), { maxItems: 20 })
  },
  { $id: 'StaffReviewItem' }
);
export const StaffReviewQueueResponseSchema = Type.Object(
  { data: Type.Array(StaffReviewItemSchema, { maxItems: 100 }) },
  { $id: 'StaffReviewQueueResponse' }
);

const AccessibilitySchema = Type.Union([
  Type.Literal('step-free'),
  Type.Literal('mixed'),
  Type.Literal('unknown')
]);
const OpenHoursSchema = Type.Object(
  {
    timezone: Type.String({ minLength: 1, maxLength: 64 }),
    schedule: Type.String({ minLength: 1, maxLength: 500 }),
    status: Type.Union([Type.Literal('open'), Type.Literal('limited'), Type.Literal('closed')])
  },
  Strict
);
export const QuestSummarySchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    title: Type.String({ minLength: 1 }),
    distanceMeters: Type.Integer({ minimum: 1 }),
    estimatedActiveMinutes: Type.Integer({ minimum: 1 }),
    accessibility: AccessibilitySchema,
    openHours: OpenHoursSchema,
    checkpointCount: Type.Integer({ minimum: 1 }),
    /** @deprecated Compatibility-only field; v1 API responses never include XP. */
    rewardXp: Type.Optional(Type.Integer({ minimum: 0 }))
  },
  { $id: 'QuestSummary' }
);
export const QuestCheckpointSchema = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    kind: Type.Union([Type.Literal('place'), Type.Literal('route'), Type.Literal('area')]),
    title: Type.String({ minLength: 1 }),
    geometry: Type.Unknown(),
    geometryVersion: Type.Integer({ minimum: 1 }),
    accessibility: AccessibilitySchema,
    openHours: OpenHoursSchema
  },
  Strict
);
export const QuestDetailSchema = Type.Intersect(
  [
    QuestSummarySchema,
    Type.Object({
      checkpoints: Type.Array(QuestCheckpointSchema, { minItems: 1, maxItems: 20 }),
      sourceReviewedAt: Type.String({ format: 'date-time' })
    })
  ],
  { $id: 'QuestDetail' }
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
const LocationCenterSchema = Type.Object(
  {
    latitude: Type.Number({ minimum: -90, maximum: 90 }),
    longitude: Type.Number({ minimum: -180, maximum: 180 })
  },
  Strict
);
export const PrivacyZoneRequestSchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 80 }),
    center: LocationCenterSchema
  },
  { ...Strict, $id: 'PrivacyZoneRequest' }
);
export const PrivacyZoneResponseSchema = Type.Object(
  {
    id: UuidSchema,
    name: Type.String(),
    center: LocationCenterSchema,
    radiusMeters: Type.Literal(200),
    geometryVersion: Type.Integer({ minimum: 1 })
  },
  { $id: 'PrivacyZoneResponse' }
);
export const WeeklyGoalRequestSchema = Type.Object(
  {
    activeMinutes: Type.Optional(Type.Integer({ minimum: 1, maximum: 10_080 })),
    distanceMeters: Type.Optional(Type.Integer({ minimum: 1, maximum: 1_000_000 }))
  },
  { ...Strict, minProperties: 1, $id: 'WeeklyGoalRequest' }
);
export const WeeklyGoalResponseSchema = Type.Object(
  {
    weekStartsOn: Type.String({ format: 'date' }),
    activeMinutes: Type.Object(
      { goal: Type.Optional(Type.Integer({ minimum: 1 })), actual: Type.Integer({ minimum: 0 }) },
      Strict
    ),
    distanceMeters: Type.Object(
      { goal: Type.Optional(Type.Integer({ minimum: 1 })), actual: Type.Integer({ minimum: 0 }) },
      Strict
    )
  },
  { $id: 'WeeklyGoalResponse' }
);

export const VisibilitySchema = Type.Union([Type.Literal('private'), Type.Literal('followers')]);
export const VisibilityRequestSchema = Type.Object(
  { activityVisibility: VisibilitySchema },
  { ...Strict, $id: 'VisibilityRequest' }
);
export const VisibilityResponseSchema = Type.Object(
  { activityVisibility: VisibilitySchema },
  { $id: 'VisibilityResponse' }
);
export const SafetyContactRequestSchema = Type.Object(
  { email: Type.String({ format: 'email', maxLength: 320 }) },
  { ...Strict, $id: 'SafetyContactRequest' }
);
export const SafetyContactResponseSchema = Type.Object(
  {
    id: UuidSchema,
    email: Type.String({ format: 'email' }),
    status: Type.Union([Type.Literal('pending'), Type.Literal('accepted')])
  },
  { $id: 'SafetyContactResponse' }
);
export const SafetyContactListResponseSchema = Type.Object(
  { data: Type.Array(SafetyContactResponseSchema, { maxItems: 50 }) },
  { $id: 'SafetyContactListResponse' }
);
export const SafetyShareRequestSchema = Type.Object(
  {
    safetyContactId: UuidSchema,
    activityId: Type.Optional(UuidSchema),
    durationMinutes: Type.Integer({ minimum: 15, maximum: 480 })
  },
  { ...Strict, $id: 'SafetyShareRequest' }
);
export const SafetyShareResponseSchema = Type.Object(
  {
    id: UuidSchema,
    safetyContactId: UuidSchema,
    status: Type.Union([Type.Literal('active'), Type.Literal('revoked'), Type.Literal('expired')]),
    delayMinutes: Type.Literal(15),
    tileSizeMeters: Type.Literal(500),
    expiresAt: Type.String({ format: 'date-time' })
  },
  { $id: 'SafetyShareResponse' }
);
export const SafetyShareParamsSchema = Type.Object(
  { shareId: UuidSchema },
  { ...Strict, $id: 'SafetyShareParams' }
);
export const SafetyShareUpdateRequestSchema = Type.Object(
  {
    latitude: Type.Number({ minimum: -90, maximum: 90 }),
    longitude: Type.Number({ minimum: -180, maximum: 180 }),
    observedAt: Type.String({ format: 'date-time' })
  },
  { ...Strict, $id: 'SafetyShareUpdateRequest' }
);
export const AccountExportResponseSchema = Type.Object(
  {
    status: Type.Literal('ready'),
    generatedAt: Type.String({ format: 'date-time' }),
    rawTraceAvailability: Type.Literal('available-within-retention-window'),
    data: Type.Object(
      {
        profile: Type.Object({
          email: Type.String({ format: 'email' }),
          activityVisibility: VisibilitySchema
        }),
        privacyZones: Type.Array(PrivacyZoneResponseSchema),
        activities: Type.Array(Type.Object({ id: UuidSchema, rawTraceAvailable: Type.Boolean() }))
      },
      Strict
    )
  },
  { $id: 'AccountExportResponse' }
);
export const AccountDeletionResponseSchema = Type.Object(
  { status: Type.Literal('scheduled') },
  { $id: 'AccountDeletionResponse' }
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
const BearerAuthorizationSchema = Type.String({ pattern: '^Bearer\\s+\\S+$' });
export const ActivityAuthorizationHeadersSchema = Type.Object(
  { authorization: BearerAuthorizationSchema },
  { additionalProperties: true, $id: 'ActivityAuthorizationHeaders' }
);
export const ActivityCreateHeadersSchema = Type.Object(
  {
    authorization: BearerAuthorizationSchema,
    'idempotency-key': Type.String({ minLength: 1, maxLength: 128 })
  },
  { additionalProperties: true, $id: 'ActivityCreateHeaders' }
);
export const ActivityChunkHeadersSchema = Type.Object(
  {
    authorization: BearerAuthorizationSchema,
    'content-encoding': Type.Optional(Type.Literal('identity')),
    'x-chunk-checksum': Type.String({ pattern: '^[a-f0-9]{64}$' })
  },
  { additionalProperties: true, $id: 'ActivityChunkHeaders' }
);
export const ActivityFinalizeRequestSchema = Type.Object(
  {
    expectedChunkCount: Type.Integer({ minimum: 1, maximum: 10000 }),
    checksum: Type.String({ pattern: '^[a-f0-9]{64}$' })
  },
  { ...Strict, $id: 'ActivityFinalizeRequest' }
);
export const ActivitySyncQuerySchema = Type.Object(
  { expectedChunkCount: Type.Integer({ minimum: 1, maximum: 10000 }) },
  { ...Strict, $id: 'ActivitySyncQuery' }
);

/** Stable UTF-8 input for hashing a JSON value across the API and mobile runtimes. */
export const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
};

/** Concatenate sequence-ordered per-chunk SHA-256 values before SHA-256 hashing the result. */
export const activityFinalizeChecksumInput = (
  chunks: ReadonlyArray<
    Pick<Static<typeof ActivityChunkRequestSchema>, 'sequence'> & { checksum: string }
  >
): string =>
  [...chunks]
    .sort((left, right) => left.sequence - right.sequence)
    .map((chunk) => chunk.checksum)
    .join('');
const ActivitySummarySchema = Type.Object(
  {
    distanceMeters: Type.Number({ minimum: 0 }),
    durationSeconds: Type.Number({ minimum: 0 }),
    pointCount: Type.Integer({ minimum: 0 }),
    rejectedPointCount: Type.Integer({ minimum: 0 }),
    rejectedGapCount: Type.Integer({ minimum: 0 }),
    privacyTrimmed: Type.Boolean()
  },
  Strict
);
const ActivityStatusSchema = Type.Union([
  Type.Literal('received'),
  Type.Literal('validating'),
  Type.Literal('accepted'),
  Type.Literal('rejected'),
  Type.Literal('derived'),
  Type.Literal('deleted')
]);
const ActivityProvenanceSchema = Type.Object(
  {
    policyVersion: Type.String(),
    algorithmVersion: Type.String(),
    removedPointCount: Type.Integer({ minimum: 0 }),
    outcome: Type.String()
  },
  Strict
);
export const ActivityStatusResponseSchema = Type.Object(
  {
    id: UuidSchema,
    status: ActivityStatusSchema,
    movementType: Type.Optional(
      Type.Union([Type.Literal('walk'), Type.Literal('run'), Type.Literal('hike')])
    ),
    createdAt: Type.Optional(Type.String({ format: 'date-time' })),
    summary: Type.Optional(ActivitySummarySchema),
    rejectionReason: Type.Optional(Type.String()),
    validationErrors: Type.Optional(Type.Array(Type.String({ maxLength: 160 }), { maxItems: 20 })),
    missingSequences: Type.Optional(Type.Array(Type.Integer({ minimum: 0 }), { maxItems: 10000 }))
  },
  { $id: 'ActivityStatusResponse' }
);
export const ActivityDetailResponseSchema = Type.Object(
  {
    id: UuidSchema,
    status: ActivityStatusSchema,
    movementType: Type.Optional(
      Type.Union([Type.Literal('walk'), Type.Literal('run'), Type.Literal('hike')])
    ),
    createdAt: Type.Optional(Type.String({ format: 'date-time' })),
    summary: Type.Optional(ActivitySummarySchema),
    rejectionReason: Type.Optional(Type.String()),
    validationErrors: Type.Optional(Type.Array(Type.String({ maxLength: 160 }), { maxItems: 20 })),
    missingSequences: Type.Optional(Type.Array(Type.Integer({ minimum: 0 }), { maxItems: 10000 })),
    geometry: Type.Optional(Type.Union([Type.Null(), Type.Unknown()])),
    provenance: Type.Optional(ActivityProvenanceSchema)
  },
  { $id: 'ActivityDetailResponse' }
);
export const ActivityListResponseSchema = Type.Object(
  { data: Type.Array(ActivityStatusResponseSchema, { maxItems: 100 }) },
  { $id: 'ActivityListResponse' }
);
/** Lifecycle responses reuse the safe status projection; raw submitted points are never included. */
export const ActivityCreateResponseSchema = ActivityStatusResponseSchema;
export const ActivityFinalizeResponseSchema = ActivityStatusResponseSchema;
export const ActivitySyncStatusResponseSchema = ActivityStatusResponseSchema;
export const ActivityChunkResponseSchema = Type.Null({ $id: 'ActivityChunkResponse' });
export const ActivityDeleteResponseSchema = Type.Null({ $id: 'ActivityDeleteResponse' });

export type HealthResponse = Static<typeof HealthResponseSchema>;
export type StaffReviewItem = Static<typeof StaffReviewItemSchema>;
export type StaffReviewQueueResponse = Static<typeof StaffReviewQueueResponseSchema>;
export type QuestSummary = Static<typeof QuestSummarySchema>;
export type QuestDetail = Static<typeof QuestDetailSchema>;
export type WeeklyGoalRequest = Static<typeof WeeklyGoalRequestSchema>;
export type WeeklyGoalResponse = Static<typeof WeeklyGoalResponseSchema>;
export type QuestParams = Static<typeof QuestParamsSchema>;
export type RegisterRequest = Static<typeof RegisterRequestSchema>;
export type LoginRequest = Static<typeof LoginRequestSchema>;
export type RefreshRequest = Static<typeof RefreshRequestSchema>;
export type PrivacyZoneRequest = Static<typeof PrivacyZoneRequestSchema>;
export type PrivacyZoneResponse = Static<typeof PrivacyZoneResponseSchema>;
export type VisibilityRequest = Static<typeof VisibilityRequestSchema>;
export type VisibilityResponse = Static<typeof VisibilityResponseSchema>;
export type SafetyContactRequest = Static<typeof SafetyContactRequestSchema>;
export type SafetyContactResponse = Static<typeof SafetyContactResponseSchema>;
export type SafetyShareRequest = Static<typeof SafetyShareRequestSchema>;
export type SafetyShareResponse = Static<typeof SafetyShareResponseSchema>;
export type SafetyShareUpdateRequest = Static<typeof SafetyShareUpdateRequestSchema>;
export type AccountExportResponse = Static<typeof AccountExportResponseSchema>;
export type AccountDeletionResponse = Static<typeof AccountDeletionResponseSchema>;
export type ActivityCreateRequest = Static<typeof ActivityCreateRequestSchema>;
export type ActivityCreateHeaders = Static<typeof ActivityCreateHeadersSchema>;
export type ActivityAuthorizationHeaders = Static<typeof ActivityAuthorizationHeadersSchema>;
export type ActivityChunkRequest = Static<typeof ActivityChunkRequestSchema>;
export type ActivityChunkHeaders = Static<typeof ActivityChunkHeadersSchema>;
export type ActivityFinalizeRequest = Static<typeof ActivityFinalizeRequestSchema>;
export type ActivitySyncQuery = Static<typeof ActivitySyncQuerySchema>;
export type ActivityStatusResponse = Static<typeof ActivityStatusResponseSchema>;
export type ActivityDetailResponse = Static<typeof ActivityDetailResponseSchema>;
