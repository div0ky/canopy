ALTER TABLE doxa_theoria_observations
  ADD COLUMN IF NOT EXISTS sequence bigint GENERATED ALWAYS AS IDENTITY;

CREATE INDEX IF NOT EXISTS doxa_theoria_execution_sequence_idx
  ON doxa_theoria_observations (execution_id, sequence);
CREATE INDEX IF NOT EXISTS doxa_theoria_correlation_sequence_idx
  ON doxa_theoria_observations (correlation_id, sequence);
