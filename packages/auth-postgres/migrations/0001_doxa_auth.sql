CREATE TABLE IF NOT EXISTS doxa_auth_identities (
  id uuid PRIMARY KEY,
  email text NOT NULL,
  email_verified_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS doxa_auth_identity_email_idx
  ON doxa_auth_identities (email);

CREATE TABLE IF NOT EXISTS doxa_auth_passwords (
  identity_id uuid PRIMARY KEY REFERENCES doxa_auth_identities(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  salt text NOT NULL,
  hash text NOT NULL,
  parameters jsonb NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS doxa_auth_sessions (
  id uuid PRIMARY KEY,
  identity_id uuid NOT NULL REFERENCES doxa_auth_identities(id) ON DELETE CASCADE,
  token_digest text NOT NULL,
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

CREATE TABLE IF NOT EXISTS doxa_auth_audit_events (
  id uuid PRIMARY KEY,
  event_type text NOT NULL,
  identity_id uuid,
  session_id uuid,
  metadata jsonb NOT NULL,
  occurred_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS doxa_auth_audit_identity_idx
  ON doxa_auth_audit_events (identity_id, occurred_at);
