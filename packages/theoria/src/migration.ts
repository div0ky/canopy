import { readdir, readFile } from 'node:fs/promises'

import { Pool } from 'pg'

export const DOXA_THEORIA_MIGRATION_URL = new URL(
  '../migrations/0001_doxa_theoria.sql',
  import.meta.url,
)
export const DOXA_THEORIA_MIGRATIONS_URL = new URL('../migrations/', import.meta.url)
/** Explicit schema helper for tests and Praxis. Runtime boot never migrates. */
export async function installTheoriaSchema(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, application_name: 'doxa-theoria-migrate' })
  try {
    const names = (await readdir(DOXA_THEORIA_MIGRATIONS_URL))
      .filter((name) => name.endsWith('.sql'))
      .sort()
    for (const name of names) {
      await pool.query(await readFile(new URL(name, DOXA_THEORIA_MIGRATIONS_URL), 'utf8'))
    }
  } finally {
    await pool.end()
  }
}
