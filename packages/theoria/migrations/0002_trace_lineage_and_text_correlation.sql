ALTER TABLE doxa_theoria_observations
  ALTER COLUMN correlation_id TYPE text USING correlation_id::text;

ALTER TABLE doxa_theoria_observations
  ADD COLUMN IF NOT EXISTS parent_span_id text,
  ADD COLUMN IF NOT EXISTS span_links jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS doxa_theoria_source_execution_idx
  ON doxa_theoria_observations (source_execution_id, sequence);
CREATE INDEX IF NOT EXISTS doxa_theoria_causation_idx
  ON doxa_theoria_observations (causation_id, sequence);
CREATE INDEX IF NOT EXISTS doxa_theoria_trace_span_idx
  ON doxa_theoria_observations (trace_id, span_id, sequence);
CREATE INDEX IF NOT EXISTS doxa_theoria_parent_span_idx
  ON doxa_theoria_observations (trace_id, parent_span_id, sequence);
