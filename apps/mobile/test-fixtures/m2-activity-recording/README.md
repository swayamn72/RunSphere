# M2 activity-recording fixtures

These deterministic, synthetic Mumbai-area traces support the M2 higher-level Android/API test plan. They contain no real-user coordinates.

- `steady-1km.gpx`: 13 fixes spaced 5 seconds apart; approximately 1 km of continuous movement for acquisition, foreground/background, pause/resume, distance, and summary cases.
- `privacy-crossing.gpx`: 11 fixes that cross a seed privacy-zone center; seed a 200 m zone at `19.076500,72.877700`. The server-derived shareable route must omit all points inside the zone while retaining discontinuous outer segments.
- `gps-gap-61s.gpx`: a normal opening sequence followed by a 61-second gap and recovery; exercises automatic eligibility pause/recovery and “save recorded portion”.
- `paused-interval.gpx`: foreground samples bracketing a 90-second explicit pause; only moving, accepted segments count toward authoritative duration.
- `weak-gps.gpx`: deliberately weak-accuracy and implausible-speed fixes; the harness maps the annotated HDOP to reported accuracy and must reject them.
- `chunk-scenarios.json`: uploads derived from `steady-1km.gpx` with ordered, duplicated, reordered, and missing chunks. It declares expected API outcomes; UUIDs/tokens are supplied by the test harness, never hard-coded here.
- `account-scope-upgrade.json`: legacy token-hash partition fixture for the in-place server-account UUID re-key, including its count/checksum expectations.

The caller must inject fixtures through the approved synthetic-GPS test mode only, not a production location provider. Use ISO timestamps as given, or apply one common offset while preserving every interval.
