CREATE TABLE IF NOT EXISTS canopy_schedule_controls (
  schedule_id text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
