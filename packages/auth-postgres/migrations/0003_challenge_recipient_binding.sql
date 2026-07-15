ALTER TABLE doxa_auth_challenges
  ADD COLUMN IF NOT EXISTS recipient_digest text;

-- Challenges issued before recipient binding cannot be trusted after an address change.
DELETE FROM doxa_auth_challenges WHERE recipient_digest IS NULL;

ALTER TABLE doxa_auth_challenges
  ALTER COLUMN recipient_digest SET NOT NULL;
