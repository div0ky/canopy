import { readFile } from 'node:fs/promises'

import { Pool } from 'pg'

export const DOXA_AUTH_MIGRATION_URL = new URL('../migrations/0001_doxa_auth.sql', import.meta.url)

/** Explicit migration helper for tests and tooling. Runtime boot never mutates schema. */
export async function installAuthSchema(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString })
  try {
    await pool.query(await readFile(DOXA_AUTH_MIGRATION_URL, 'utf8'))
  } finally {
    await pool.end()
  }
}
