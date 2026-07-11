import {
  Cache,
  type CachePutOptions,
  type Disposes,
  type JsonValue,
  type LifecycleContext,
  type Starts,
} from '@canopy/core'
import { Pool } from 'pg'

export interface PostgresCacheOptions {
  readonly connectionString: string
  readonly applicationName?: string
}

export class PostgresCache extends Cache implements Starts, Disposes {
  #pool: Pool | undefined

  constructor(private readonly options: PostgresCacheOptions) {
    super()
  }

  async start(context: LifecycleContext): Promise<void> {
    if (context.signal.aborted) throw context.signal.reason
    const pool = new Pool({
      connectionString: this.options.connectionString,
      ...(this.options.applicationName ? { application_name: this.options.applicationName } : {}),
    })
    await pool.query('select 1')
    this.#pool = pool
  }

  async get<Value extends JsonValue>(key: string): Promise<Value | undefined> {
    const result = await this.pool().query<{ value: Value }>(
      `
      DELETE FROM canopy_cache_entries
      WHERE key = $1 AND expires_at IS NOT NULL AND expires_at <= now()
    `,
      [key],
    )
    void result
    const found = await this.pool().query<{ value: Value }>(
      `
      SELECT value FROM canopy_cache_entries WHERE key = $1
    `,
      [key],
    )
    return found.rows[0]?.value
  }

  async put<Value extends JsonValue>(
    key: string,
    value: Value,
    options?: CachePutOptions,
  ): Promise<void> {
    await this.pool().query(
      `
      INSERT INTO canopy_cache_entries (key, value, expires_at)
      VALUES ($1, $2::jsonb, $3)
      ON CONFLICT (key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at
    `,
      [key, JSON.stringify(value), expiresAt(options)],
    )
  }

  async add<Value extends JsonValue>(
    key: string,
    value: Value,
    options?: CachePutOptions,
  ): Promise<boolean> {
    const result = await this.pool().query(
      `
      INSERT INTO canopy_cache_entries (key, value, expires_at)
      VALUES ($1, $2::jsonb, $3)
      ON CONFLICT (key) DO UPDATE SET
        value = excluded.value,
        expires_at = excluded.expires_at
      WHERE canopy_cache_entries.expires_at IS NOT NULL
        AND canopy_cache_entries.expires_at <= now()
    `,
      [key, JSON.stringify(value), expiresAt(options)],
    )
    return result.rowCount === 1
  }

  async increment(key: string, amount = 1, options?: CachePutOptions): Promise<number> {
    if (!Number.isFinite(amount)) throw new TypeError('Cache increment amount must be finite.')
    const result = await this.pool().query<{ value: JsonValue }>(
      `
      INSERT INTO canopy_cache_entries (key, value, expires_at)
      VALUES ($1, to_jsonb($2::double precision), $3)
      ON CONFLICT (key) DO UPDATE SET
        value = CASE
          WHEN canopy_cache_entries.expires_at IS NOT NULL AND canopy_cache_entries.expires_at <= now()
            THEN excluded.value
          WHEN jsonb_typeof(canopy_cache_entries.value) = 'number'
            THEN to_jsonb((canopy_cache_entries.value #>> '{}')::double precision + $2)
          ELSE canopy_cache_entries.value
        END,
        expires_at = CASE
          WHEN canopy_cache_entries.expires_at IS NOT NULL AND canopy_cache_entries.expires_at <= now()
            THEN excluded.expires_at
          ELSE canopy_cache_entries.expires_at
        END
      RETURNING value
    `,
      [key, amount, expiresAt(options)],
    )
    const value = result.rows[0]?.value
    if (typeof value !== 'number') throw new TypeError(`Cache value ${key} is not numeric.`)
    return value
  }

  async forget(key: string): Promise<boolean> {
    const result = await this.pool().query('DELETE FROM canopy_cache_entries WHERE key = $1', [key])
    return result.rowCount === 1
  }

  async dispose(): Promise<void> {
    const pool = this.#pool
    this.#pool = undefined
    await pool?.end()
  }

  private pool(): Pool {
    if (!this.#pool) throw new Error('PostgreSQL cache is not started.')
    return this.#pool
  }
}

function expiresAt(options?: CachePutOptions): Date | undefined {
  if (options?.ttlSeconds === undefined) return undefined
  if (!Number.isFinite(options.ttlSeconds) || options.ttlSeconds <= 0) {
    throw new TypeError('Cache ttlSeconds must be a positive finite number.')
  }
  return new Date(Date.now() + options.ttlSeconds * 1_000)
}
