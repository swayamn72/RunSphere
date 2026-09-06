# Live-Run Map UX Requirements

**Last updated:** 2026-09-06  
**Applies to:** Android v1 live activity screen and route suggestion preview screen.

This document specifies the map behavior during an active run and on the route suggestion preview. The reference model is Google Maps navigation mode — a moving, runner-centred map with a visible path trace.

**Renderer:** MapLibre React Native (already in the workspace).

---

## 1. Live Activity Map (during a run)

### 1.1 Map centering and camera

- The map is **always centred on the runner's current GPS position** while running.
- The camera follows the runner automatically. The user does not need to scroll back to find themselves.
- Camera bearing: optionally rotated to match heading direction (north-up vs. heading-up can be a user toggle).
- Default zoom level: shows approximately 400–600 m radius around the runner.

### 1.2 Path trace (the "bread crumb" line)

- As the runner moves, a **coloured polyline is drawn on the map** connecting each accepted GPS point.
- The line grows in real time — it shows exactly where the runner has been during this activity.
- The line colour: use the RunSphere brand accent (configurable, e.g. lime/teal). It must be clearly visible against both light and dark map styles.
- Line width: thick enough to be readable at the default zoom level (minimum 4dp).
- The path is rendered locally from accepted GPS points stored in the encrypted local SQLite database — it is never fetched from the server during an active run.

### 1.3 Relocation button

- A fixed button (bottom-right corner, above the zoom controls) that re-centres the map on the runner's current position.
- Icon: a crosshair or "locate" symbol, identical in purpose to the location button in Google Maps.
- State: the button is **highlighted/active** when the map is auto-following the runner. It becomes **dimmed** when the user has manually panned the map away. Tapping it re-centres and re-enables auto-follow.
- Tap behaviour: immediately snaps camera back to current position and re-enables automatic following.

### 1.4 Zoom controls

- Two visible on-screen buttons: **+** (zoom in) and **−** (zoom out). Stacked vertically, bottom-right area.
- Pinch-to-zoom gesture also supported (standard MapLibre behaviour — do not disable it).
- When the user zooms, auto-follow is **NOT disabled** — the map stays centred on the runner at the new zoom level.
- Minimum zoom: enough to see surrounding streets (~14 in MapLibre zoom units).
- Maximum zoom: close enough to see individual building footprints (~19).

### 1.5 Route suggestion overlay (if a route was accepted before starting)

- If the runner accepted a route suggestion before starting, the suggested loop shape is shown on the map as a **secondary, translucent polyline** (different colour/style from the live trace, e.g. dashed or lower opacity).
- This is a **reference only** — the runner is not required to follow it. No alerts, no penalties for going off-route.
- The overlay does not update or recalculate while running. It is static from the moment the run started.

### 1.6 Quest checkpoint markers

- If the run has an associated quest, each checkpoint is shown as a **map pin/marker**.
- Completed checkpoints: distinct visual state (e.g. filled icon).
- Upcoming checkpoints: outlined/pending icon.
- The runner does not need to tap the checkpoint on the map — validation happens server-side from the GPS trace after the run.

### 1.7 Current position indicator

- A pulsing dot or arrow at the runner's current GPS position, consistent with standard map conventions.
- The indicator should clearly show heading direction when available.

### 1.8 Live metrics overlay

- Distance, duration, and current pace shown in an overlay panel above or below the map (not on the map itself).
- All metrics are provisional (validated by server after the run). The UI must make this clear — e.g. "Live" label, values shown without false precision.
- No heart rate, calorie, or speed ranking shown.

### 1.9 Offline behaviour

- If the device loses connectivity mid-run, the map tiles that are already rendered remain visible (MapLibre caches tiles).
- The path trace continues to grow from locally recorded GPS points.
- An offline indicator is shown (small banner or icon).
- Quest checkpoint state and territory scoring remain pending until the server validates the trace after the run.

### 1.10 GPS quality indicator

- A subtle signal-strength indicator (e.g. coloured dot near the metrics) shows current GPS accuracy:
  - Green: ≤50 m horizontal accuracy (accepted samples).
  - Amber: 50–100 m (flagged samples).
  - Red: >100 m or no fix (rejected samples; territory scoring paused if gap >60 s).
- When GPS is poor, show a non-alarming message: "GPS signal is weak — your route is still recording."

---

## 2. Route Suggestion Preview Map (before starting a run)

### 2.1 Purpose

Before the runner starts, they are shown a suggested running loop on the map. They can adjust it and then accept it to start.

### 2.2 Loop display

- The suggested route is shown as a closed polyline loop on the map.
- The loop is centred on the runner's current coarse location.
- The map is not auto-following — it is a static preview centred on the loop.

### 2.3 Adjustment controls (below the map)

Two controls are shown beneath the map:

**Distance slider / input:**  
- Shows current suggested distance (e.g. "3.2 km").
- Runner can drag or tap +/− to reduce or increase the distance.
- Minimum: 1 km. Maximum: 10 km.
- When adjusted, the map redraws the loop shape to match the new distance target. The new loop is fetched from the server (or generated locally from cached path data).

**Time input:**  
- Runner can optionally type or select a target time (e.g. "I have 30 minutes").
- The system recalculates the distance based on a default pace estimate (e.g. 6 min/km for a moderate run).
- Distance control updates to reflect the recalculated distance.

### 2.4 Multiple suggestions

- Up to 3 route options are shown (e.g. as tabs or a card carousel: "Short ~2 km", "Medium ~4 km", "Long ~6 km").
- Tapping a tab replaces the loop on the map.
- Each suggestion is a different loop shape, not just a scaled version of the same one.

### 2.5 Accept and start

- A prominent "Start run" button accepts the selected route and begins the activity.
- Tapping "Start without route" begins a free run with no suggested overlay.

---

## 3. Implementation Notes for Developers

- The map renderer is **MapLibre React Native** — already declared in `apps/mobile`.
- GPS data is sourced from the location adapter (`apps/mobile/src/location-adapter.ts`).
- Accepted GPS points are stored in the encrypted SQLite activity database — use those for drawing the live trace, not a separate in-memory structure.
- The route suggestion API endpoint does not exist yet. When building it, it must:
  - Accept the runner's coarse location (not precise — only coarse is needed for route generation).
  - Accept `targetDistanceKm` and optionally `targetMinutes` as parameters.
  - Return a GeoJSON LineString (the loop shape) and the computed distance.
  - Only use curated MMR path data — no routing through unverified or private areas.
- The relocation button re-centres the MapLibre camera on the current GPS coordinate — use the MapLibre camera API, not a full re-render.
- Zoom controls call MapLibre's `zoomIn()` / `zoomOut()` camera methods.
- Do not use the live map to display other runners' positions, live territory battles, or any real-time social data.
