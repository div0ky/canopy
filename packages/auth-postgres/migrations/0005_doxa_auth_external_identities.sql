ALTER TABLE doxa_auth_passwords DROP CONSTRAINT IF EXISTS doxa_auth_passwords_identity_id_fkey;
ALTER TABLE doxa_auth_sessions DROP CONSTRAINT IF EXISTS doxa_auth_sessions_identity_id_fkey;
ALTER TABLE doxa_auth_access_tokens DROP CONSTRAINT IF EXISTS doxa_auth_access_tokens_identity_id_fkey;
ALTER TABLE doxa_auth_challenges DROP CONSTRAINT IF EXISTS doxa_auth_challenges_identity_id_fkey;

ALTER TABLE doxa_auth_identities ALTER COLUMN id TYPE text USING id::text;
ALTER TABLE doxa_auth_passwords ALTER COLUMN identity_id TYPE text USING identity_id::text;
ALTER TABLE doxa_auth_sessions ALTER COLUMN identity_id TYPE text USING identity_id::text;
ALTER TABLE doxa_auth_access_tokens ALTER COLUMN identity_id TYPE text USING identity_id::text;
ALTER TABLE doxa_auth_challenges ALTER COLUMN identity_id TYPE text USING identity_id::text;
ALTER TABLE doxa_auth_audit_events ALTER COLUMN identity_id TYPE text USING identity_id::text;

ALTER TABLE doxa_auth_passwords
  ADD CONSTRAINT doxa_auth_passwords_identity_id_fkey
  FOREIGN KEY (identity_id) REFERENCES doxa_auth_identities(id) ON DELETE CASCADE;
