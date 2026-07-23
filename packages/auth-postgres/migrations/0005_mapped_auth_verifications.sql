CREATE TABLE IF NOT EXISTS doxa_auth_mapped_verifications (
  identity_id text PRIMARY KEY,
  contact_email_digest text NOT NULL,
  verified_at timestamptz NOT NULL
);
