DROP VIEW IF EXISTS doxa_theoria_all_observations;

ALTER TABLE doxa_theoria_observations
  ADD COLUMN IF NOT EXISTS resource jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE doxa_theoria_observations_warm
  ADD COLUMN IF NOT EXISTS resource jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE VIEW doxa_theoria_all_observations AS
  SELECT * FROM doxa_theoria_observations
  UNION ALL
  SELECT * FROM doxa_theoria_observations_warm;
