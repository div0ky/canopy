import { readFile } from 'node:fs/promises'

import { Pool } from 'pg'

export const CANOPY_PERSISTENCE_MIGRATION_URL = new URL(
  '../migrations/0001_canopy_durability.sql',
  import.meta.url,
)
export const CANOPY_CACHE_MIGRATION_URL = new URL(
  '../migrations/0002_canopy_cache.sql',
  import.meta.url,
)
export const CANOPY_COMMUNICATIONS_MIGRATION_URL = new URL(
  '../migrations/0003_canopy_communications.sql',
  import.meta.url,
)

/** Explicit migration helper for tests and tooling. Runtime boot never calls this. */
export async function installPersistenceSchema(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString })
  try {
    await pool.query(await readFile(CANOPY_PERSISTENCE_MIGRATION_URL, 'utf8'))
  } finally {
    await pool.end()
  }
}

/** Explicit cache-schema helper for tests and Arbor migrations. */
export async function installCacheSchema(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString })
  try {
    await pool.query(await readFile(CANOPY_CACHE_MIGRATION_URL, 'utf8'))
  } finally {
    await pool.end()
  }
}

export async function installCommunicationsSchema(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString })
  try { await pool.query(await readFile(CANOPY_COMMUNICATIONS_MIGRATION_URL, 'utf8')) }
  finally { await pool.end() }
}
