import {
  ObservationRecorder,
  type Disposes,
  type Drains,
  type LifecycleContext,
  type Observation,
  type Starts,
} from '@doxajs/core'
import { Pool } from 'pg'

export interface PostgresTheoriaOptions {
  readonly connectionString: string
  readonly applicationName?: string
  readonly retentionDays?: number
  readonly maximumObservations?: number
  readonly environment?: string
  readonly allowProduction?: boolean
}

export class PostgresTheoria extends ObservationRecorder implements Starts, Drains, Disposes {
  static readonly id = 'theoria'
  #pool: Pool | undefined
  readonly #pending = new Set<Promise<void>>()
  #tail: Promise<void> = Promise.resolve()
  #writes = 0

  constructor(private readonly options: PostgresTheoriaOptions) {
    super()
  }

  async start(context: LifecycleContext): Promise<void> {
    if (context.signal.aborted) throw context.signal.reason
    validateRetention(this.options)
    const environment = this.options.environment ?? process.env.NODE_ENV ?? 'development'
    if (environment === 'production' && this.options.allowProduction !== true) {
      throw new Error(
        'Theoria is disabled in production unless allowProduction is explicitly true.',
      )
    }
    const pool = new Pool({
      connectionString: this.options.connectionString,
      application_name: this.options.applicationName ?? 'doxa-theoria',
    })
    await pool.query('SELECT 1 FROM doxa_theoria_observations LIMIT 1')
    this.#pool = pool
  }

  record(observation: Observation): void {
    const pool = this.#pool
    if (!pool) return
    this.#writes += 1
    const write = this.#tail
      .then(() => insertObservation(pool, observation))
      .then(async () => {
        if (this.#writes % 500 === 0) {
          await pruneWithPool(
            pool,
            this.options.retentionDays ?? 7,
            this.options.maximumObservations ?? 50_000,
          )
        }
      })
      .catch(() => undefined)
    this.#tail = write
    this.#pending.add(write)
    void write.finally(() => this.#pending.delete(write))
  }

  async drain(_context: LifecycleContext): Promise<void> {
    await Promise.allSettled([...this.#pending])
  }

  async dispose(_context: LifecycleContext): Promise<void> {
    await Promise.allSettled([...this.#pending])
    const pool = this.#pool
    this.#pool = undefined
    await pool?.end()
  }

  async prune(): Promise<number> {
    const pool = this.#pool
    if (!pool) throw new Error('Theoria is not started.')
    return await pruneWithPool(
      pool,
      this.options.retentionDays ?? 7,
      this.options.maximumObservations ?? 50_000,
    )
  }
}

export async function pruneTheoria(
  connectionString: string,
  options: Pick<PostgresTheoriaOptions, 'retentionDays' | 'maximumObservations'> = {},
): Promise<number> {
  validateRetention({ connectionString, ...options })
  const pool = new Pool({ connectionString, application_name: 'doxa-theoria-prune' })
  try {
    return await pruneWithPool(
      pool,
      options.retentionDays ?? 7,
      options.maximumObservations ?? 50_000,
    )
  } finally {
    await pool.end()
  }
}

async function insertObservation(pool: Pool, observation: Observation): Promise<void> {
  const context = observation.context
  await pool.query(
    `
    INSERT INTO doxa_theoria_observations (
      id, occurred_at, kind, name, phase, role_id, duration_ms,
      execution_id, source_execution_id, correlation_id, causation_id,
      trace_id, span_id, actor_kind, actor_id, tenant_id, transport, transport_name,
      attributes, error
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7,
      $8, $9, $10, $11,
      $12, $13, $14, $15, $16, $17, $18,
      $19::jsonb, $20::jsonb
    ) ON CONFLICT (id) DO NOTHING
  `,
    [
      observation.id,
      observation.occurredAt,
      observation.kind,
      observation.name,
      observation.phase,
      observation.roleId ?? null,
      observation.durationMilliseconds ?? null,
      context.executionId ?? null,
      context.sourceExecutionId ?? null,
      context.correlationId ?? null,
      context.causationId ?? null,
      context.traceId ?? null,
      context.spanId ?? null,
      context.actorKind ?? null,
      context.actorId ?? null,
      context.tenantId ?? null,
      context.transport ?? null,
      context.transportName ?? null,
      JSON.stringify(observation.attributes),
      observation.error ? JSON.stringify(observation.error) : null,
    ],
  )
}

async function pruneWithPool(pool: Pool, retentionDays: number, maximum: number): Promise<number> {
  const result = await pool.query(
    `
    WITH expired AS (
      DELETE FROM doxa_theoria_observations
      WHERE occurred_at < now() - ($1::double precision * interval '1 day')
      RETURNING 1
    ), overflow AS (
      DELETE FROM doxa_theoria_observations
      WHERE id IN (
        SELECT id FROM doxa_theoria_observations
        ORDER BY occurred_at DESC, id DESC
        OFFSET $2
      )
      RETURNING 1
    )
    SELECT (SELECT count(*) FROM expired) + (SELECT count(*) FROM overflow) AS count
  `,
    [retentionDays, maximum],
  )
  return Number(result.rows[0]?.count ?? 0)
}

function validateRetention(options: PostgresTheoriaOptions): void {
  if (
    options.retentionDays !== undefined &&
    (!Number.isFinite(options.retentionDays) || options.retentionDays <= 0)
  ) {
    throw new TypeError('Theoria retentionDays must be positive.')
  }
  if (
    options.maximumObservations !== undefined &&
    (!Number.isInteger(options.maximumObservations) || options.maximumObservations <= 0)
  ) {
    throw new TypeError('Theoria maximumObservations must be a positive integer.')
  }
}
