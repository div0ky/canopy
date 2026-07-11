ALTER TABLE doxa_auth_sessions
  ADD COLUMN IF NOT EXISTS previous_token_digest text,
  ADD COLUMN IF NOT EXISTS previous_token_expires_at timestamptz;

CREATE INDEX IF NOT EXISTS doxa_auth_session_previous_token_idx
  ON doxa_auth_sessions (previous_token_digest)
  WHERE previous_token_digest IS NOT NULL;
