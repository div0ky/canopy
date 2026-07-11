import type { Observation } from '@doxajs/core'
import { Pool } from 'pg'

export interface TheoriaQuery {
  readonly kind?: string
  readonly phase?: string
  readonly search?: string
  readonly limit?: number
}

export interface TheoriaExecution {
  readonly executionId: string
  readonly correlationId?: string
  readonly sourceExecutionId?: string
  readonly name: string
  readonly transport?: string
  readonly phase: string
  readonly occurredAt: string
  readonly durationMilliseconds?: number
  readonly observationCount: number
}

export interface TheoriaEntry {
  readonly entryId: string
  readonly executionId: string
  readonly correlationId?: string
  readonly sourceExecutionId?: string
  readonly name: string
  readonly kind: string
  readonly roleId?: string
  readonly transport?: string
  readonly phase: string
  readonly occurredAt: string
  readonly durationMilliseconds?: number
}

export class TheoriaStore {
  readonly #pool: Pool

  constructor(connectionString: string) {
    this.#pool = new Pool({ connectionString, application_name: 'doxa-theoria-ui' })
  }

  async executions(query: TheoriaQuery = {}): Promise<readonly TheoriaExecution[]> {
    const limit = Math.min(Math.max(query.limit ?? 100, 1), 500)
    const values: unknown[] = []
    const conditions = ['candidate.execution_id IS NOT NULL']
    if (query.kind) {
      values.push(query.kind)
      conditions.push(`candidate.kind = $${values.length}`)
    }
    if (query.phase) {
      values.push(query.phase)
      conditions.push(`candidate.phase = $${values.length}`)
    }
    if (query.search) {
      values.push(`%${query.search}%`)
      conditions.push(
        `(candidate.name ILIKE $${values.length} OR candidate.role_id ILIKE $${values.length} OR candidate.actor_id ILIKE $${values.length} OR candidate.execution_id::text ILIKE $${values.length} OR candidate.correlation_id::text ILIKE $${values.length})`,
      )
    }
    values.push(limit)
    const result = await this.#pool.query<{
      execution_id: string
      correlation_id: string | null
      source_execution_id: string | null
      name: string
      transport: string | null
      phase: string
      occurred_at: Date
      duration_ms: number | null
      observation_count: string
    }>(
      `
      WITH eligible AS (
        SELECT DISTINCT candidate.execution_id
        FROM doxa_theoria_observations candidate
        WHERE ${conditions.join(' AND ')}
      ), ranked AS (
        SELECT observation.execution_id, observation.correlation_id, observation.source_execution_id,
          observation.name, observation.transport, observation.phase, observation.occurred_at,
          observation.duration_ms,
          count(*) OVER (PARTITION BY observation.execution_id) AS observation_count,
          row_number() OVER (
            PARTITION BY observation.execution_id
            ORDER BY
              CASE
                WHEN observation.kind = 'execution' AND observation.phase IN ('completed', 'failed') THEN 0
                WHEN observation.kind = 'execution' THEN 1
                ELSE 2
              END,
              observation.sequence DESC NULLS LAST,
              observation.occurred_at DESC,
              observation.id DESC
          ) AS position
        FROM doxa_theoria_observations observation
        JOIN eligible ON eligible.execution_id = observation.execution_id
      )
      SELECT execution_id, correlation_id, source_execution_id, name, transport, phase,
        occurred_at, duration_ms, observation_count
      FROM ranked WHERE position = 1
      ORDER BY occurred_at DESC, execution_id
      LIMIT $${values.length}
    `,
      values,
    )
    return result.rows.map((row) => ({
      executionId: row.execution_id,
      ...(row.correlation_id ? { correlationId: row.correlation_id } : {}),
      ...(row.source_execution_id ? { sourceExecutionId: row.source_execution_id } : {}),
      name: row.name,
      ...(row.transport ? { transport: row.transport } : {}),
      phase: row.phase,
      occurredAt: row.occurred_at.toISOString(),
      ...(row.duration_ms === null ? {} : { durationMilliseconds: row.duration_ms }),
      observationCount: Number(row.observation_count),
    }))
  }

  async entries(query: TheoriaQuery): Promise<readonly TheoriaEntry[]> {
    const limit = Math.min(Math.max(query.limit ?? 100, 1), 500)
    const values: unknown[] = []
    const conditions = ['execution_id IS NOT NULL', "phase IN ('occurred', 'completed', 'failed')"]
    if (query.kind) {
      values.push(query.kind)
      conditions.push(`kind = $${values.length}`)
    }
    if (query.phase) {
      values.push(query.phase)
      conditions.push(`phase = $${values.length}`)
    }
    if (query.search) {
      values.push(`%${query.search}%`)
      conditions.push(
        `(name ILIKE $${values.length} OR role_id ILIKE $${values.length} OR actor_id ILIKE $${values.length} OR execution_id::text ILIKE $${values.length} OR correlation_id::text ILIKE $${values.length})`,
      )
    }
    values.push(limit)
    const result = await this.#pool.query<{
      id: string
      execution_id: string
      correlation_id: string | null
      source_execution_id: string | null
      name: string
      kind: string
      role_id: string | null
      transport: string | null
      phase: string
      occurred_at: Date
      duration_ms: number | null
    }>(
      `
      SELECT id, execution_id, correlation_id, source_execution_id, name, kind, role_id,
        transport, phase, occurred_at, duration_ms
      FROM doxa_theoria_observations
      WHERE ${conditions.join(' AND ')}
      ORDER BY occurred_at DESC, id DESC
      LIMIT $${values.length}
    `,
      values,
    )
    return result.rows.map((row) => ({
      entryId: row.id,
      executionId: row.execution_id,
      ...(row.correlation_id ? { correlationId: row.correlation_id } : {}),
      ...(row.source_execution_id ? { sourceExecutionId: row.source_execution_id } : {}),
      name: row.name,
      kind: row.kind,
      ...(row.role_id ? { roleId: row.role_id } : {}),
      ...(row.transport ? { transport: row.transport } : {}),
      phase: row.phase,
      occurredAt: row.occurred_at.toISOString(),
      ...(row.duration_ms === null ? {} : { durationMilliseconds: row.duration_ms }),
    }))
  }

  async timeline(executionId: string): Promise<readonly Observation[]> {
    const correlation = await this.#pool.query<{ correlation_id: string | null }>(
      `
      SELECT correlation_id FROM doxa_theoria_observations
      WHERE execution_id = $1 ORDER BY sequence NULLS LAST, occurred_at, id LIMIT 1
    `,
      [executionId],
    )
    const correlationId = correlation.rows[0]?.correlation_id
    const result = await this.#pool.query(
      `
      SELECT * FROM doxa_theoria_observations
      WHERE execution_id = $1 OR ($2::uuid IS NOT NULL AND correlation_id = $2::uuid)
      ORDER BY sequence NULLS LAST, occurred_at, id
    `,
      [executionId, correlationId ?? null],
    )
    return result.rows.map(toObservation)
  }

  async close(): Promise<void> {
    await this.#pool.end()
  }
}

function toObservation(row: Record<string, unknown>): Observation {
  const optional = <T>(key: string): T | undefined =>
    row[key] === null || row[key] === undefined ? undefined : (row[key] as T)
  return {
    id: String(row.id),
    occurredAt: (row.occurred_at as Date).toISOString(),
    kind: row.kind as Observation['kind'],
    name: String(row.name),
    phase: row.phase as Observation['phase'],
    ...(optional<string>('role_id') ? { roleId: optional<string>('role_id')! } : {}),
    ...(optional<number>('duration_ms') === undefined
      ? {}
      : { durationMilliseconds: optional<number>('duration_ms')! }),
    context: {
      ...(optional<string>('execution_id')
        ? { executionId: optional<string>('execution_id')! }
        : {}),
      ...(optional<string>('source_execution_id')
        ? { sourceExecutionId: optional<string>('source_execution_id')! }
        : {}),
      ...(optional<string>('correlation_id')
        ? { correlationId: optional<string>('correlation_id')! }
        : {}),
      ...(optional<string>('causation_id')
        ? { causationId: optional<string>('causation_id')! }
        : {}),
      ...(optional<string>('trace_id') ? { traceId: optional<string>('trace_id')! } : {}),
      ...(optional<string>('span_id') ? { spanId: optional<string>('span_id')! } : {}),
      ...(optional<Observation['context']['actorKind']>('actor_kind')
        ? { actorKind: optional<Observation['context']['actorKind']>('actor_kind')! }
        : {}),
      ...(optional<string>('actor_id') ? { actorId: optional<string>('actor_id')! } : {}),
      ...(optional<string>('tenant_id') ? { tenantId: optional<string>('tenant_id')! } : {}),
      ...(optional<string>('transport') ? { transport: optional<string>('transport')! } : {}),
      ...(optional<string>('transport_name')
        ? { transportName: optional<string>('transport_name')! }
        : {}),
    },
    attributes: row.attributes as Observation['attributes'],
    ...(row.error ? { error: row.error as NonNullable<Observation['error']> } : {}),
  }
}
