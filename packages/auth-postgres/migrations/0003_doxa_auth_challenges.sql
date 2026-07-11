CREATE TABLE IF NOT EXISTS doxa_auth_challenges (
  id uuid PRIMARY KEY,
  identity_id uuid NOT NULL REFERENCES doxa_auth_identities(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('email_verification', 'password_reset')),
  token_digest text NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS doxa_auth_challenge_token_idx ON doxa_auth_challenges (token_digest);
CREATE INDEX IF NOT EXISTS doxa_auth_challenge_identity_idx ON doxa_auth_challenges (identity_id, purpose, consumed_at);

CREATE TABLE IF NOT EXISTS doxa_auth_rate_limits (
  action text NOT NULL,
  bucket_key text NOT NULL,
  window_started_at timestamptz NOT NULL,
  attempts integer NOT NULL CHECK (attempts > 0),
  blocked_until timestamptz,
  PRIMARY KEY (action, bucket_key)
);
