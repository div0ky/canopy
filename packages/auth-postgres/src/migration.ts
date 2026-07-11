import { readFile } from 'node:fs/promises'

import { Pool } from 'pg'

export const CANOPY_AUTH_MIGRATION_URL = new URL(
  '../migrations/0001_canopy_auth.sql',
  import.meta.url,
)
export const CANOPY_AUTH_ACCESS_TOKEN_MIGRATION_URL = new URL(
  '../migrations/0002_canopy_auth_access_tokens.sql',
  import.meta.url,
)
export const CANOPY_AUTH_CHALLENGE_MIGRATION_URL = new URL(
  '../migrations/0003_canopy_auth_challenges.sql',
  import.meta.url,
)
export const CANOPY_AUTH_SESSION_ROTATION_MIGRATION_URL = new URL(
  '../migrations/0004_canopy_auth_session_rotation.sql',
  import.meta.url,
)
export const CANOPY_AUTH_EXTERNAL_IDENTITIES_MIGRATION_URL = new URL(
  '../migrations/0005_canopy_auth_external_identities.sql',
  import.meta.url,
)

/** Explicit migration helper for tests and tooling. Runtime boot never mutates schema. */
export async function installAuthSchema(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString })
  try {
    for (const migration of [CANOPY_AUTH_MIGRATION_URL, CANOPY_AUTH_ACCESS_TOKEN_MIGRATION_URL, CANOPY_AUTH_CHALLENGE_MIGRATION_URL, CANOPY_AUTH_SESSION_ROTATION_MIGRATION_URL, CANOPY_AUTH_EXTERNAL_IDENTITIES_MIGRATION_URL]) {
      await pool.query(await readFile(migration, 'utf8'))
    }
  } finally {
    await pool.end()
  }
}
