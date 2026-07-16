CREATE TABLE IF NOT EXISTS doxa_queue_attempt_traces (
  job_id uuid NOT NULL,
  attempt integer NOT NULL CHECK (attempt > 0),
  trace_id text NOT NULL,
  span_id text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, attempt)
);

CREATE INDEX IF NOT EXISTS doxa_queue_attempt_traces_updated_idx
  ON doxa_queue_attempt_traces (updated_at);
