CREATE TABLE IF NOT EXISTS doxa_auth_access_tokens (
  id text PRIMARY KEY,
  identity_id uuid NOT NULL REFERENCES doxa_auth_identities(id) ON DELETE CASCADE,
  name text NOT NULL,
  display_prefix text NOT NULL,
  token_digest text NOT NULL,
  constraints jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  last_used_at timestamptz,
  revoked_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS doxa_auth_access_token_digest_idx ON doxa_auth_access_tokens (token_digest);
CREATE INDEX IF NOT EXISTS doxa_auth_access_token_identity_idx ON doxa_auth_access_tokens (identity_id, revoked_at);
CREATE INDEX IF NOT EXISTS doxa_auth_access_token_expiry_idx ON doxa_auth_access_tokens (expires_at);
