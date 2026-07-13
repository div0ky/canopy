CREATE TABLE IF NOT EXISTS doxa_auth_identities (
  id text PRIMARY KEY,
  email text NOT NULL,
  email_verified_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS doxa_auth_identity_email_idx
  ON doxa_auth_identities (email);

CREATE TABLE IF NOT EXISTS doxa_auth_passwords (
  identity_id text PRIMARY KEY REFERENCES doxa_auth_identities(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  salt text NOT NULL,
  hash text NOT NULL,
  parameters jsonb NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS doxa_auth_sessions (
  id uuid PRIMARY KEY,
  identity_id text NOT NULL,
  token_digest text NOT NULL,
  previous_token_digest text,
  previous_token_expires_at timestamptz,
  created_at timestamptz NOT NULL,
  authenticated_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  idle_expires_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  ip_address text,
  user_agent text
);

CREATE UNIQUE INDEX IF NOT EXISTS doxa_auth_session_token_idx
  ON doxa_auth_sessions (token_digest);
CREATE INDEX IF NOT EXISTS doxa_auth_session_identity_idx
  ON doxa_auth_sessions (identity_id, revoked_at);
CREATE INDEX IF NOT EXISTS doxa_auth_session_expiry_idx
  ON doxa_auth_sessions (expires_at, idle_expires_at);
CREATE INDEX IF NOT EXISTS doxa_auth_session_previous_token_idx
  ON doxa_auth_sessions (previous_token_digest)
  WHERE previous_token_digest IS NOT NULL;

CREATE TABLE IF NOT EXISTS doxa_auth_access_tokens (
  id text PRIMARY KEY,
  identity_id text NOT NULL,
  name text NOT NULL,
  display_prefix text NOT NULL,
  token_digest text NOT NULL,
  constraints jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  last_used_at timestamptz,
  revoked_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS doxa_auth_access_token_digest_idx
  ON doxa_auth_access_tokens (token_digest);
CREATE INDEX IF NOT EXISTS doxa_auth_access_token_identity_idx
  ON doxa_auth_access_tokens (identity_id, revoked_at);
CREATE INDEX IF NOT EXISTS doxa_auth_access_token_expiry_idx
  ON doxa_auth_access_tokens (expires_at);

CREATE TABLE IF NOT EXISTS doxa_auth_audit_events (
  id uuid PRIMARY KEY,
  event_type text NOT NULL,
  identity_id text,
  session_id uuid,
  metadata jsonb NOT NULL,
  occurred_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS doxa_auth_audit_identity_idx
  ON doxa_auth_audit_events (identity_id, occurred_at);

CREATE TABLE IF NOT EXISTS doxa_auth_challenges (
  id uuid PRIMARY KEY,
  identity_id text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('email_verification', 'password_reset')),
  token_digest text NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS doxa_auth_challenge_token_idx
  ON doxa_auth_challenges (token_digest);
CREATE INDEX IF NOT EXISTS doxa_auth_challenge_identity_idx
  ON doxa_auth_challenges (identity_id, purpose, consumed_at);

CREATE TABLE IF NOT EXISTS doxa_auth_rate_limits (
  action text NOT NULL,
  bucket_key text NOT NULL,
  window_started_at timestamptz NOT NULL,
  attempts integer NOT NULL CHECK (attempts > 0),
  blocked_until timestamptz,
  PRIMARY KEY (action, bucket_key)
);
