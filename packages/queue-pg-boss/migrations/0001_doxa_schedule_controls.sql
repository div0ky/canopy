CREATE TABLE IF NOT EXISTS doxa_schedule_controls (
  schedule_id text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT true,
  last_reconciled_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
