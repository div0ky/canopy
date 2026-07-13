CREATE TABLE IF NOT EXISTS doxa_theoria_observations (
  id uuid PRIMARY KEY,
  sequence bigint GENERATED ALWAYS AS IDENTITY,
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

CREATE INDEX IF NOT EXISTS doxa_theoria_execution_idx
  ON doxa_theoria_observations (execution_id, occurred_at, id);
CREATE INDEX IF NOT EXISTS doxa_theoria_correlation_idx
  ON doxa_theoria_observations (correlation_id, occurred_at, id);
CREATE INDEX IF NOT EXISTS doxa_theoria_recent_idx
  ON doxa_theoria_observations (occurred_at DESC, id);
CREATE INDEX IF NOT EXISTS doxa_theoria_kind_idx
  ON doxa_theoria_observations (kind, occurred_at DESC);
CREATE INDEX IF NOT EXISTS doxa_theoria_failed_idx
  ON doxa_theoria_observations (occurred_at DESC)
  WHERE phase = 'failed';
CREATE INDEX IF NOT EXISTS doxa_theoria_execution_sequence_idx
  ON doxa_theoria_observations (execution_id, sequence);
CREATE INDEX IF NOT EXISTS doxa_theoria_correlation_sequence_idx
  ON doxa_theoria_observations (correlation_id, sequence);
