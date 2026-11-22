-- Run metrics (M9 tasks 9.9-9.11).
--
-- One row per derived run: splits, best efforts, elevation and the pace and
-- elevation chart series, computed by computeRunMetrics (packages/domain
-- run-metrics.ts) when the run is derived. Raw points are purged after 30
-- days (raw_trace_retention_until), so this row is the only lasting record of
-- them beyond the totals. It holds no coordinates: everything is keyed by
-- distance along the run.
--
-- metrics holds the whole RunMetrics object. moving_seconds and
-- elevation_gain_meters are copied out of it for the run log (9.13), which
-- lists many runs and shouldn't unpack jsonb per row.
--
-- metrics_version is RUN_METRICS_VERSION at compute time. A write replaces a
-- row only with a newer version, so a replayed derivation or the backfill
-- (9.10) never overwrites newer numbers with older ones.
--
-- Rollback: additive. Older builds never read the table. To undo,
-- DROP TABLE IF EXISTS activity_metrics once no build reads it.

CREATE TABLE IF NOT EXISTS activity_metrics (
  activity_id uuid PRIMARY KEY REFERENCES activity_submissions(id) ON DELETE CASCADE,
  metrics_version integer NOT NULL CHECK (metrics_version >= 1),
  metrics jsonb NOT NULL,
  moving_seconds double precision NOT NULL CHECK (moving_seconds >= 0),
  elevation_gain_meters double precision CHECK (elevation_gain_meters >= 0),
  computed_at timestamptz NOT NULL DEFAULT now()
);

-- The backfill looks for runs whose metrics are missing or out of date.
CREATE INDEX IF NOT EXISTS activity_metrics_version_idx ON activity_metrics (metrics_version);
