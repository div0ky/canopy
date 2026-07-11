import { readFile } from 'node:fs/promises'

import { Pool } from 'pg'

export const CANOPY_UNDERGROWTH_MIGRATION_URL = new URL(
  '../migrations/0001_canopy_undergrowth.sql',
  import.meta.url,
)
export const CANOPY_UNDERGROWTH_SEQUENCE_MIGRATION_URL = new URL(
  '../migrations/0002_canopy_undergrowth_sequence.sql',
  import.meta.url,
)

/** Explicit schema helper for tests and Arbor. Runtime boot never migrates. */
export async function installUndergrowthSchema(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, application_name: 'canopy-undergrowth-migrate' })
  try {
    await pool.query(await readFile(CANOPY_UNDERGROWTH_MIGRATION_URL, 'utf8'))
    await pool.query(await readFile(CANOPY_UNDERGROWTH_SEQUENCE_MIGRATION_URL, 'utf8'))
  }
  finally { await pool.end() }
}
