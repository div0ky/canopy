CREATE TABLE IF NOT EXISTS doxa_theoria_observations_warm (
  LIKE doxa_theoria_observations INCLUDING DEFAULTS
) PARTITION BY RANGE (occurred_at);

CREATE INDEX IF NOT EXISTS doxa_theoria_warm_execution_sequence_idx
  ON doxa_theoria_observations_warm (execution_id, sequence);
CREATE INDEX IF NOT EXISTS doxa_theoria_warm_correlation_sequence_idx
  ON doxa_theoria_observations_warm (correlation_id, sequence);
CREATE INDEX IF NOT EXISTS doxa_theoria_warm_source_execution_idx
  ON doxa_theoria_observations_warm (source_execution_id, sequence);
CREATE INDEX IF NOT EXISTS doxa_theoria_warm_causation_idx
  ON doxa_theoria_observations_warm (causation_id, sequence);
CREATE INDEX IF NOT EXISTS doxa_theoria_warm_trace_span_idx
  ON doxa_theoria_observations_warm (trace_id, span_id, sequence);

CREATE OR REPLACE VIEW doxa_theoria_all_observations AS
  SELECT * FROM doxa_theoria_observations
  UNION ALL
  SELECT * FROM doxa_theoria_observations_warm;
