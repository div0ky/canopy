CREATE TABLE IF NOT EXISTS doxa_cache_entries (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  expires_at timestamptz
);

CREATE INDEX IF NOT EXISTS doxa_cache_expiry_idx
  ON doxa_cache_entries (expires_at)
  WHERE expires_at IS NOT NULL;
