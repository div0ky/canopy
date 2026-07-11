import { readFile } from 'node:fs/promises'

import { Pool } from 'pg'

export const DOXA_THEORIA_MIGRATION_URL = new URL(
  '../migrations/0001_doxa_theoria.sql',
  import.meta.url,
)
export const DOXA_THEORIA_SEQUENCE_MIGRATION_URL = new URL(
  '../migrations/0002_doxa_theoria_sequence.sql',
  import.meta.url,
)

/** Explicit schema helper for tests and Praxis. Runtime boot never migrates. */
export async function installTheoriaSchema(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, application_name: 'doxa-theoria-migrate' })
  try {
    await pool.query(await readFile(DOXA_THEORIA_MIGRATION_URL, 'utf8'))
    await pool.query(await readFile(DOXA_THEORIA_SEQUENCE_MIGRATION_URL, 'utf8'))
  } finally {
    await pool.end()
  }
}
