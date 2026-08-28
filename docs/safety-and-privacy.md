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

## Location handling and 200 m privacy blur

Raw GPS is sensitive operational data. The client records only while an activity is active and the granted capability permits it. It stores pending submissions in an Expo SQLite database compiled with SQLCipher; the database key is generated on-device and held only in Android Keystore-backed SecureStore, then transmits over TLS for server validation.

## Android encrypted-storage upgrade

Activity databases are opened with `PRAGMA key` before *any* schema or data access. The upgrade re-keys legacy local account partitions (the historic token-hash scope and the prior `account:<UUID>` scope) to the server account UUID by updating the encrypted database in place—there is no plaintext database copy. Before completing the migration, the recorder compares source/destination row counts and a deterministic checksum of stable row fields; any mismatch aborts recovery.

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
