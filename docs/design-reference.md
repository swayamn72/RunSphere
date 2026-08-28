# Approved design-artifact traceability

The approved artifacts are tracked in this repository under [`docs/design/`](design/). They communicate intended mobile flows and visual language; they do not override the safety, privacy, or release rules in this documentation.

| Artifact                                                         | Product obligation / documented implementation note                                                                                      |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| [Onboarding](design/onboarding-welcome-default.html)             | Walk and run are shown; implementation adds hike and mandatory adult age assertion before activation.                                    |
| [Permissions & privacy](design/permissions-privacy-default.html) | Foreground precise location is feature-gated; motion/fitness is optional; “hide start & finish” is a server-enforced 200 m trim.         |
| [Home](design/home-dashboard-default.html)                       | Weekly goals use server-provided validated activity only; Home lists fetched verified quest summaries without fabricated daily progress. |
| [Live activity](design/live-activity-default.html)               | Live metrics are provisional; server validates distance, quests, and territory later.                                                    |
| [Quest discovery](design/quest-discovery-default.html)           | Quest cards require verified checkpoint/POI data, closure handling, and an unavailable/fallback state.                                   |
| [Activity results](design/activity-results-default.html)         | Cells/results reconcile from server validation. “Add photos or notes” must not enable photo uploads in v1.                               |
| [Territory season](design/territory-season-default.html)         | Implements optional enrollment, pre-territory/no-season state, best daily 60-minute rule, pace neutrality, and divisions.                |
| [Club challenge](design/club-challenge-default.html)             | Exact routes stay private. Activity visibility cannot bypass server trimming.                                                            |
| [Analytics profile](design/analytics-profile-default.html)       | Movement insight remains non-comparative and pace-neutral.                                                                               |
| [Safety controls](design/safety-controls-default.html)           | “LiveTrack” is opt-in delayed/coarse sharing with a safety contact; it is not exact live tracking.                                       |
| [Offline state](design/offline-state-default.html)               | Activity continues locally; cell/quest outcomes remain pending until validation.                                                         |
| [GPS recovery](design/gps-error-default.html)                    | Explain quality pause and preserve a non-competitive recorded portion where safe.                                                        |
| [Profile settings](design/profile-settings-default.html)         | Settings include activity visibility, 200 m zones, safety contacts, export, deletion, and walk/run/hike preferences.                     |

The source index is [design-plan.json](design/design-plan.json).
