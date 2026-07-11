import { readFile } from 'node:fs/promises'

import { Pool } from 'pg'

export const DOXA_AUTH_MIGRATION_URL = new URL('../migrations/0001_doxa_auth.sql', import.meta.url)
export const DOXA_AUTH_ACCESS_TOKEN_MIGRATION_URL = new URL(
  '../migrations/0002_doxa_auth_access_tokens.sql',
  import.meta.url,
)
export const DOXA_AUTH_CHALLENGE_MIGRATION_URL = new URL(
  '../migrations/0003_doxa_auth_challenges.sql',
  import.meta.url,
)
export const DOXA_AUTH_SESSION_ROTATION_MIGRATION_URL = new URL(
  '../migrations/0004_doxa_auth_session_rotation.sql',
  import.meta.url,
)
export const DOXA_AUTH_EXTERNAL_IDENTITIES_MIGRATION_URL = new URL(
  '../migrations/0005_doxa_auth_external_identities.sql',
  import.meta.url,
)

/** Explicit migration helper for tests and tooling. Runtime boot never mutates schema. */
export async function installAuthSchema(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString })
  try {
    for (const migration of [
      DOXA_AUTH_MIGRATION_URL,
      DOXA_AUTH_ACCESS_TOKEN_MIGRATION_URL,
      DOXA_AUTH_CHALLENGE_MIGRATION_URL,
      DOXA_AUTH_SESSION_ROTATION_MIGRATION_URL,
      DOXA_AUTH_EXTERNAL_IDENTITIES_MIGRATION_URL,
    ]) {
      await pool.query(await readFile(migration, 'utf8'))
    }
  } finally {
    await pool.end()
  }
}
