import { readFile } from 'node:fs/promises'

import { Pool } from 'pg'

export const DOXA_PERSISTENCE_MIGRATION_URL = new URL(
  '../migrations/0001_doxa_durability.sql',
  import.meta.url,
)
export const DOXA_CACHE_MIGRATION_URL = new URL(
  '../migrations/0001_doxa_cache.sql',
  import.meta.url,
)
export const DOXA_COMMUNICATIONS_MIGRATION_URL = new URL(
  '../migrations/0001_doxa_communications.sql',
  import.meta.url,
)
/** Explicit migration helper for tests and tooling. Runtime boot never calls this. */
export async function installPersistenceSchema(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString })
  try {
    await pool.query(await readFile(DOXA_PERSISTENCE_MIGRATION_URL, 'utf8'))
  } finally {
    await pool.end()
  }
}

/** Explicit cache-schema helper for tests and Praxis migrations. */
export async function installCacheSchema(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString })
  try {
    await pool.query(await readFile(DOXA_CACHE_MIGRATION_URL, 'utf8'))
  } finally {
    await pool.end()
  }
}

export async function installCommunicationsSchema(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString })
  try {
    await pool.query(await readFile(DOXA_COMMUNICATIONS_MIGRATION_URL, 'utf8'))
  } finally {
    await pool.end()
  }
}
