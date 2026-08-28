# Safety and privacy

**Applies to:** Android v1 and iOS v1.1 unless explicitly marked otherwise.  
**Principle:** Collect the minimum location and activity data required for a requested feature, expose less than is collected, and make opt-in sharing reversible.

The intended UI is represented by the approved [permissions and privacy](design/permissions-privacy-default.html), [safety controls](design/safety-controls-default.html), [profile/privacy](design/profile-settings-default.html), and [GPS recovery](design/gps-error-default.html) artifacts.

## Consent and permissions

| Capability                            | Consent                                                      | v1 behavior                                                                                                                                                |
| ------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account eligibility                   | Required age assertion: “I confirm I am 18 or older”         | Block account activation until asserted; store assertion timestamp and policy version, not DOB.                                                            |
| Foreground precise location           | Just-in-time OS permission before activity recording         | Required to create a route, calculate distance, validate checkpoints, or participate in territory. A declined permission leaves browse/settings available. |
| Background location                   | Separate, feature-specific OS permission                     | Not required for v1 core activity recording. Do not request by default.                                                                                    |
| Motion & fitness/activity recognition | Separate just-in-time OS permission                          | Optional. Improves activity classification and may support distance quality; declining uses location-only estimates and must not block an activity.        |
| Contacts                              | In-app entry of a safety contact or explicit platform picker | Optional; never upload a device address book.                                                                                                              |
| Live sharing                          | Explicit per-activity start and recipient selection          | Optional and off by default.                                                                                                                               |

Permission explanations name the capability, purpose, retention path, and decline outcome before the OS dialog. Consent changes take effect on the next applicable action; revocation stops new collection and surfaces what remains saved.

## Map connectivity and provider privacy

Android includes `ACCESS_NETWORK_STATE`, a normal non-prompting permission, solely so the map renderer can distinguish unavailable connectivity from a map-style failure and present recoverable offline behavior. It does not expose network identifiers, request location, or broaden data collection. `ACCESS_WIFI_STATE` remains blocked. Background location, storage/media, overlay, biometric, and fingerprint permissions remain blocked; the Android manifest explicitly removes biometric permissions because the current native dependency graph declares them.

Map providers are opt-in through an approved HTTPS style origin and exact provider attribution wording. When configuration is absent, invalid, rejected, offline, or fails to load, the app uses its own fallback surface and plain product copy. It does not select an unapproved public style or tile endpoint.

Style and tile requests may contain only provider resource URLs, ordinary tile coordinates, and provider-required non-user-specific authentication. Account IDs, activity IDs, route samples, checkpoints, and other coordinate-bearing product data must never appear in provider URLs, query parameters, headers, referrers, telemetry, analytics, or logs. Route and checkpoint GeoJSON remains local to the renderer.

Provider attribution must remain visible and accessible at 12sp or larger. The selected provider’s required attribution URL/tappable behavior is a release-setup requirement and must be recorded after provider approval; no unapproved attribution links are embedded in the app.

## Location handling and 200 m privacy blur

Raw GPS is sensitive operational data. The client records only while an activity is active and the granted capability permits it. It stores pending submissions in an Expo SQLite database compiled with SQLCipher; the database key is generated on-device and held only in Android Keystore-backed SecureStore, then transmits over TLS for server validation.

## Android encrypted-storage upgrade

Activity databases are opened with `PRAGMA key` before _any_ schema or data access. The upgrade re-keys legacy local account partitions (the historic token-hash scope and the prior `account:<UUID>` scope) to the server account UUID by updating the encrypted database in place—there is no plaintext database copy. Before completing the migration, the recorder compares source/destination row counts and a deterministic checksum of stable row fields; any mismatch aborts recovery.

SQLCipher is enabled through the Expo SQLite config plugin and therefore applies app-wide to every database opened through `expo-sqlite`, not only the activity recorder. A native rebuild is required after changing this plugin setting, and every app-owned Expo SQLite database must be opened with its own key before it is accessed. Do not add a new `expo-sqlite` database without registering and testing its key lifecycle.

Before any saved activity is displayed to another person, used in a club feed, or exported for sharing, the server applies privacy zones and removes the start and finish portions that fall within a **200 m radius** of a saved private place. This is a geodesic 200 m radius, not a screen-pixel approximation. The server also removes route fragments inside the zone; it never merely obscures them in the UI. If trimming leaves too little route to safely share, the activity has no map preview.

Territory rendering uses validated H3-cell aggregates only. It does not disclose an exact route, current position, origin, or destination.

## Server-side trimming, provenance, and disputes

The server creates an immutable processing record for every accepted activity. Each derived route carries:

- source activity ID and submission checksum;
- raw-trace encryption-key reference and retention class;
- validation algorithm/version and policy version;
- privacy-zone IDs and geometry versions applied;
- trim operation, timestamps, removed-point count, and resulting-route checksum;
- territory/quest decision and rule version, where applicable.

Only authorized operational workflows may access raw traces, and access is logged. The shareable route, quest decisions, and territory results derive from the server-trimmed version only. A person may request deletion; deletion must remove the raw trace and derived artifacts according to the retention policy and revoke future sharing. A challenge or support review uses provenance and the minimum necessary trace window, never an unlogged database export.

## Safety contacts and delayed coarse live sharing

A safety contact is a person chosen by the account holder. The product must use symmetric terminology:

- the account holder is the **sharer**;
- the chosen person is the **safety contact**;
- when visibility is active, the contact sees a **shared activity**.

Do not call either party a “follower,” “guardian,” or “emergency responder.” A safety contact relationship does not grant access to historical routes.

Live sharing is off unless the sharer explicitly enables it for that activity and selects a safety contact. v1 sharing is **delayed and coarse**: updates are delayed by at least **15 minutes**, transformed to a coarse cell/area of at least **500 m**, and stop when the activity ends, the sharer stops sharing, or the maximum shared-activity duration expires. Exact coordinates, exact route, and private zones are never sent to a safety contact. The UI clearly states the delay and coarseness before activation and while active.

The safety screen must include local-services guidance and state that RunSphere is not an emergency service. “Contact safety contact” initiates the selected communication channel; it does not claim to dispatch help.

## Reporting, telemetry, and crash data

Crash reporting is permitted only with coordinate scrubbing enabled before an event leaves the device. The scrubber must remove latitude/longitude fields, route polyline strings, geocoded addresses, place IDs tied to private locations, and payload keys matching coordinate patterns. Crash reports may include app version, device/OS version, error stack, feature flag versions, and non-location activity state.

Operational analytics uses derived counters and coarse geography where necessary. Raw location traces are not an analytics dimension. Support logs must redact authorization tokens, contact details, and coordinate-bearing payloads.

## Retention and user controls

Retention durations and deletion-service objectives must be published before public launch and reviewed with legal/privacy owners. Until then, production collection must remain limited to the pilot terms. The account settings must provide:

- activity visibility and privacy-zone controls;
- safety-contact management and active-sharing status;
- data export request;
- account deletion request;
- consent and permission guidance.

No photos are accepted, processed, or retained in v1. The results mockup’s “Add photos or notes” affordance is not a v1 commitment; it must be hidden or replaced with non-upload functionality until a later approved policy and architecture decision.

## Social identity, friends, and blocks

Friendship and challenge surfaces are gated by mutual authorization. A friend
request must be accepted by both accounts before any challenge or friend board
uses the relationship. Blocking is symmetric from the blocker's perspective: it
immediately removes the other account from friend boards, challenge creation,
and any shareable surface, and it is reversible. A blocked account is never
notified that it was blocked.

Social surfaces expose only an approved display identity and cosmetic, never
coarse location, exact route, or activity timestamps. No location-based
discovery of nearby runners exists.

## Clubs and competition privacy

Club boards, challenges, relays, and competitions are isolated by `club_id` and
visible only to active members or enrolled participants. Leaving, removal,
suspension, or archive immediately removes access while preserving audited
historical results according to policy. Club relays and leaderboards receive
only aggregate completion data — never another member's route, location, pace,
or raw contribution details.

## Territory and leaderboard privacy

Global leaderboards are opt-in only, off by default, and separately revocable.
They rank only server-derived pace-neutral scores and expose no location, route,
activity detail, timestamps, or live state. See
[ADR-0007](adr/0007-opt-in-privacy-minimized-leaderboards.md).

Territory uses validated H3-cell aggregates only. Other participants' map cells
expose no route, timestamp, exact start/finish, or owner identity. Territory
contribution and cell-control rules are defined in
[ADR-0008](adr/0008-seasonal-territory-weekly-resets.md).

## Notifications and push

The durable in-app inbox is the source of truth. Push contains an opaque
notification ID and a safe deep link, never location or sensitive scores. The
app requests Android notification permission in context and honors category
preferences, quiet hours, and frequency caps. Notification payloads are
coordinate-scrubbed like crash and analytics data.

## Campaign email

Transactional email (verification, password reset, change-email, security) is
separate from opt-in product campaigns. Campaigns require consent, a visible
one-click unsubscribe, provider authentication, signed webhook handling, send
caps, test sends, and an audited pause/cancel path. Suppression and bounce
handling converge with account deletion.

## Legal versioning and compliance

Terms, Privacy Notice, Community Guidelines, and Competition/Season Rules are
versioned, and consent records reference the exact version presented. Disclosures
must be updated for location derivation, H3 territory, social identity,
challenges, clubs, moderation, profiling/recommendations, analytics, processors,
push, email, export, and deletion before each relevant phase ships.

Before public rollout, confirm the final implementation against current MeitY
DPDP Rules, Google Play UGC/account-deletion policies (including a public web
deletion-request path in addition to in-app deletion), Android notification
requirements, and sender-provider rules.
