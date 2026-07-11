CREATE TABLE IF NOT EXISTS canopy_undergrowth_observations (
  id uuid PRIMARY KEY,
  occurred_at timestamptz NOT NULL,
  kind text NOT NULL,
  name text NOT NULL,
  phase text NOT NULL,
  role_id text,
  duration_ms double precision,
  execution_id uuid,
  source_execution_id uuid,
  correlation_id uuid,
  causation_id text,
  trace_id text,
  span_id text,
  actor_kind text,
  actor_id text,
  tenant_id text,
  transport text,
  transport_name text,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  error jsonb
);

CREATE INDEX IF NOT EXISTS canopy_undergrowth_execution_idx
  ON canopy_undergrowth_observations (execution_id, occurred_at, id);
CREATE INDEX IF NOT EXISTS canopy_undergrowth_correlation_idx
  ON canopy_undergrowth_observations (correlation_id, occurred_at, id);
CREATE INDEX IF NOT EXISTS canopy_undergrowth_recent_idx
  ON canopy_undergrowth_observations (occurred_at DESC, id);
CREATE INDEX IF NOT EXISTS canopy_undergrowth_kind_idx
  ON canopy_undergrowth_observations (kind, occurred_at DESC);
CREATE INDEX IF NOT EXISTS canopy_undergrowth_failed_idx
  ON canopy_undergrowth_observations (occurred_at DESC)
  WHERE phase = 'failed';
