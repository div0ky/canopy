ALTER TABLE canopy_undergrowth_observations
  ADD COLUMN IF NOT EXISTS sequence bigint GENERATED ALWAYS AS IDENTITY;

CREATE INDEX IF NOT EXISTS canopy_undergrowth_execution_sequence_idx
  ON canopy_undergrowth_observations (execution_id, sequence);
CREATE INDEX IF NOT EXISTS canopy_undergrowth_correlation_sequence_idx
  ON canopy_undergrowth_observations (correlation_id, sequence);
