import {
  ObservationRecorder,
  type Disposes,
  type Drains,
  type LifecycleContext,
  type Observation,
  type ObservationResource,
  type Starts,
} from '@doxajs/core'
import { createHash } from 'node:crypto'
import { Pool } from 'pg'

export type TheoriaProfile = 'development' | 'production-diagnostics'
export type TheoriaOverflowPolicy = 'drop-oldest' | 'drop-newest'

export interface PostgresTheoriaOptions {
  readonly connectionString: string
  readonly applicationName?: string
  readonly hotRetentionDays?: number
  readonly warmRetentionDays?: number
  readonly maximumObservations?: number
  readonly environment?: string
  readonly profile?: TheoriaProfile
  readonly productionEnabled?: boolean
  readonly sampleRate?: number
  readonly includeKinds?: readonly Observation['kind'][]
  readonly includePhases?: readonly Observation['phase'][]
  readonly includeNames?: readonly string[]
  readonly minimumDurationMilliseconds?: number
  readonly maximumPending?: number
  readonly overflowPolicy?: TheoriaOverflowPolicy
  readonly batchSize?: number
  readonly flushIntervalMilliseconds?: number
  readonly poolMaximum?: number
  readonly resource?: Partial<ObservationResource> &
    Pick<ObservationResource, 'application' | 'service'>
}

export interface TheoriaRecorderHealth {
  readonly queued: number
  readonly accepted: number
  readonly persisted: number
  readonly dropped: number
  readonly writeFailures: number
  readonly lastWriteErrorAt?: string
}

export class PostgresTheoria extends ObservationRecorder implements Starts, Drains, Disposes {
  static readonly id = 'theoria'
  #pool: Pool | undefined
  readonly #queue: Observation[] = []
  readonly #pendingStarts = new Map<string, Observation>()
  #flushTimer: NodeJS.Timeout | undefined
  #flushPromise: Promise<void> | undefined
  #accepted = 0
  #persisted = 0
  #dropped = 0
  #writeFailures = 0
  #lastWriteErrorAt: string | undefined
  #resource: ObservationResource | undefined

  constructor(private readonly options: PostgresTheoriaOptions) {
    super()
  }

  async start(context: LifecycleContext): Promise<void> {
    if (context.signal.aborted) throw context.signal.reason
    validateRetention(this.options)
    validateCapture(this.options)
    const processEnvironment = process.env.NODE_ENV
    const environment = this.options.environment ?? processEnvironment ?? 'development'
    const productionEnabled =
      this.options.profile === 'production-diagnostics' && this.options.productionEnabled === true
    if (
      (processEnvironment === 'production' || environment === 'production') &&
      !productionEnabled
    ) {
      throw new Error(
        'Theoria production diagnostics require profile production-diagnostics and explicit production enablement.',
      )
    }
    const pool = new Pool({
      connectionString: this.options.connectionString,
      application_name: this.options.applicationName ?? 'doxa-theoria',
      max: this.options.poolMaximum ?? 4,
    })
    await pool.query('SELECT 1 FROM doxa_theoria_observations LIMIT 1')
    this.#pool = pool
    this.#resource = Object.freeze({
      application: this.options.resource?.application ?? this.options.applicationName ?? 'doxa',
      service: this.options.resource?.service ?? this.options.applicationName ?? 'doxa',
      environment: this.options.resource?.environment ?? environment,
      ...((this.options.resource?.release ?? process.env.DOXA_RELEASE)
        ? { release: this.options.resource?.release ?? process.env.DOXA_RELEASE! }
        : {}),
      ...((this.options.resource?.instanceId ?? process.env.DOXA_INSTANCE_ID)
        ? { instanceId: this.options.resource?.instanceId ?? process.env.DOXA_INSTANCE_ID! }
        : {}),
    })
  }

  record(observation: Observation): void {
    const resource = this.#resource
    if (!this.#pool || !resource || !shouldCaptureBase(observation, this.options)) return
    const captured = Object.freeze({
      ...structuredClone(observation),
      resource,
    })
    const minimumDuration = this.options.minimumDurationMilliseconds
    const spanKey = observationSpanKey(captured)
    if (minimumDuration !== undefined && captured.phase === 'started' && spanKey) {
      this.#stageStart(spanKey, captured)
      return
    }
    if (
      minimumDuration !== undefined &&
      (captured.phase === 'completed' || captured.phase === 'failed')
    ) {
      const started = spanKey ? this.#pendingStarts.get(spanKey) : undefined
      if (spanKey) this.#pendingStarts.delete(spanKey)
      if ((captured.durationMilliseconds ?? 0) < minimumDuration) return
      this.#enqueue(started ? [started, captured] : [captured])
      return
    }
    if (minimumDuration !== undefined && captured.phase === 'occurred') return
    this.#enqueue([captured])
  }

  #stageStart(spanKey: string, observation: Observation): void {
    const maximumPending = this.options.maximumPending ?? 10_000
    if (this.#queuedCount() >= maximumPending) {
      if ((this.options.overflowPolicy ?? 'drop-newest') === 'drop-newest') {
        this.#dropped += 1
        return
      }
      this.#dropOldest()
    }
    this.#pendingStarts.set(spanKey, observation)
  }

  #enqueue(observations: readonly Observation[]): void {
    const maximumPending = this.options.maximumPending ?? 10_000
    let retained = observations
    if (retained.length > maximumPending) {
      this.#dropped += retained.length - maximumPending
      retained = retained.slice(-maximumPending)
    }
    while (this.#queuedCount() + retained.length > maximumPending) {
      if ((this.options.overflowPolicy ?? 'drop-newest') === 'drop-newest') {
        this.#dropped += retained.length
        return
      }
      this.#dropOldest()
    }
    this.#accepted += retained.length
    this.#queue.push(...retained)
    if (this.#queue.length >= (this.options.batchSize ?? 100)) void this.#flush()
    else this.#scheduleFlush()
  }

  #queuedCount(): number {
    return this.#queue.length + this.#pendingStarts.size
  }

  #dropOldest(): void {
    if (this.#queue.length > 0) this.#queue.shift()
    else {
      const first = this.#pendingStarts.keys().next().value as string | undefined
      if (first) this.#pendingStarts.delete(first)
    }
    this.#dropped += 1
  }

  async drain(_context: LifecycleContext): Promise<void> {
    this.#clearFlushTimer()
    this.#dropped += this.#pendingStarts.size
    this.#pendingStarts.clear()
    while (this.#queue.length > 0 || this.#flushPromise) await this.#flush()
  }

  async dispose(context: LifecycleContext): Promise<void> {
    await this.drain(context)
    const pool = this.#pool
    this.#pool = undefined
    await pool?.end()
  }

  async prune(): Promise<number> {
    const pool = this.#pool
    if (!pool) throw new Error('Theoria is not started.')
    return await pruneWithPool(
      pool,
      this.options.hotRetentionDays ?? 7,
      this.options.maximumObservations ?? 50_000,
      this.options.warmRetentionDays,
    )
  }

  health(): TheoriaRecorderHealth {
    return Object.freeze({
      queued: this.#queuedCount(),
      accepted: this.#accepted,
      persisted: this.#persisted,
      dropped: this.#dropped,
      writeFailures: this.#writeFailures,
      ...(this.#lastWriteErrorAt ? { lastWriteErrorAt: this.#lastWriteErrorAt } : {}),
    })
  }

  #scheduleFlush(): void {
    if (this.#flushTimer || this.#flushPromise) return
    this.#flushTimer = setTimeout(() => {
      this.#flushTimer = undefined
      void this.#flush()
    }, this.options.flushIntervalMilliseconds ?? 100)
    this.#flushTimer.unref()
  }

  #clearFlushTimer(): void {
    if (!this.#flushTimer) return
    clearTimeout(this.#flushTimer)
    this.#flushTimer = undefined
  }

  async #flush(): Promise<void> {
    if (this.#flushPromise) return await this.#flushPromise
    const pool = this.#pool
    if (!pool || this.#queue.length === 0) return
    this.#clearFlushTimer()
    const batch = this.#queue.splice(0, this.options.batchSize ?? 100)
    const flush = insertObservations(pool, batch)
      .then(async () => {
        this.#persisted += batch.length
        if (this.#persisted > 0 && this.#persisted % 500 < batch.length) {
          await pruneWithPool(
            pool,
            this.options.hotRetentionDays ?? 7,
            this.options.maximumObservations ?? 50_000,
            this.options.warmRetentionDays,
          )
        }
      })
      .catch(() => {
        this.#writeFailures += 1
        this.#dropped += batch.length
        this.#lastWriteErrorAt = new Date().toISOString()
      })
      .finally(() => {
        this.#flushPromise = undefined
        if (this.#queue.length > 0) this.#scheduleFlush()
      })
    this.#flushPromise = flush
    await flush
  }
}

export async function pruneTheoria(
  connectionString: string,
  options: Pick<
    PostgresTheoriaOptions,
    'hotRetentionDays' | 'warmRetentionDays' | 'maximumObservations'
  > = {},
): Promise<number> {
  validateRetention({ connectionString, ...options })
  const pool = new Pool({ connectionString, application_name: 'doxa-theoria-prune' })
  try {
    return await pruneWithPool(
      pool,
      options.hotRetentionDays ?? 7,
      options.maximumObservations ?? 50_000,
      options.warmRetentionDays,
    )
  } finally {
    await pool.end()
  }
}

async function insertObservations(pool: Pool, observations: readonly Observation[]): Promise<void> {
  if (observations.length === 0) return
  await pool.query(
    `
    INSERT INTO doxa_theoria_observations (
      id, occurred_at, kind, name, phase, role_id, duration_ms,
      execution_id, source_execution_id, correlation_id, causation_id,
      trace_id, span_id, parent_span_id, span_links,
      actor_kind, actor_id, tenant_id, transport, transport_name,
      resource, attributes, error
    )
    SELECT id, occurred_at, kind, name, phase, role_id, duration_ms,
      execution_id, source_execution_id, correlation_id, causation_id,
      trace_id, span_id, parent_span_id, span_links,
      actor_kind, actor_id, tenant_id, transport, transport_name, resource, attributes, error
    FROM jsonb_to_recordset($1::jsonb) AS batch(
      id uuid, occurred_at timestamptz, kind text, name text, phase text, role_id text,
      duration_ms double precision, execution_id uuid, source_execution_id uuid,
      correlation_id text, causation_id text, trace_id text, span_id text, parent_span_id text,
      span_links jsonb, actor_kind text, actor_id text, tenant_id text, transport text,
      transport_name text, resource jsonb, attributes jsonb, error jsonb
    )
    ON CONFLICT (id) DO NOTHING
  `,
    [JSON.stringify(observations.map(observationRow))],
  )
}

function observationRow(observation: Observation) {
  const context = observation.context
  return {
    id: observation.id,
    occurred_at: observation.occurredAt,
    kind: observation.kind,
    name: observation.name,
    phase: observation.phase,
    role_id: observation.roleId ?? null,
    duration_ms: observation.durationMilliseconds ?? null,
    execution_id: context.executionId ?? null,
    source_execution_id: context.sourceExecutionId ?? null,
    correlation_id: context.correlationId ?? null,
    causation_id: context.causationId ?? null,
    trace_id: context.traceId ?? null,
    span_id: context.spanId ?? null,
    parent_span_id: context.parentSpanId ?? null,
    span_links: context.links ?? [],
    actor_kind: context.actorKind ?? null,
    actor_id: context.actorId ?? null,
    tenant_id: context.tenantId ?? null,
    transport: context.transport ?? null,
    transport_name: context.transportName ?? null,
    resource: observation.resource ?? {},
    attributes: observation.attributes,
    error: observation.error ?? null,
  }
}

function shouldCaptureBase(observation: Observation, options: PostgresTheoriaOptions): boolean {
  if (options.includeKinds && !options.includeKinds.includes(observation.kind)) return false
  if (options.includePhases && !options.includePhases.includes(observation.phase)) return false
  if (options.includeNames && !options.includeNames.includes(observation.name)) return false
  const sampleRate = options.sampleRate ?? 1
  if (sampleRate >= 1) return true
  if (sampleRate <= 0) return false
  const key = observation.context.executionId ?? observation.context.correlationId ?? observation.id
  const bucket = createHash('sha256').update(key).digest().readUInt32BE(0) / 0x1_0000_0000
  return bucket < sampleRate
}

function observationSpanKey(observation: Observation): string | undefined {
  const traceId = observation.context.traceId
  const spanId = observation.context.spanId
  return traceId && spanId
    ? `${traceId}:${spanId}:${observation.kind}:${observation.name}:${observation.roleId ?? ''}`
    : undefined
}

async function pruneWithPool(
  pool: Pool,
  hotRetentionDays: number,
  maximum: number,
  warmRetentionDays?: number,
): Promise<number> {
  let droppedWarmRows = 0
  if (warmRetentionDays !== undefined) {
    await archiveWarmObservations(pool, hotRetentionDays, warmRetentionDays)
    droppedWarmRows = await dropExpiredWarmPartitions(pool, warmRetentionDays)
  }
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
    [hotRetentionDays, maximum],
  )
  return Number(result.rows[0]?.count ?? 0) + droppedWarmRows
}

async function archiveWarmObservations(
  pool: Pool,
  hotRetentionDays: number,
  warmRetentionDays: number,
): Promise<number> {
  const months = await pool.query<{ month: Date }>(
    `
      SELECT DISTINCT date_trunc('month', occurred_at) AS month
      FROM doxa_theoria_observations
      WHERE occurred_at < now() - ($1::double precision * interval '1 day')
        AND occurred_at >= now() - ($2::double precision * interval '1 day')
    `,
    [hotRetentionDays, warmRetentionDays],
  )
  for (const row of months.rows) await ensureWarmPartition(pool, row.month)
  if (months.rows.length === 0) return 0
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query(
      `
        WITH moved AS (
          DELETE FROM doxa_theoria_observations
          WHERE occurred_at < now() - ($1::double precision * interval '1 day')
            AND occurred_at >= now() - ($2::double precision * interval '1 day')
          RETURNING *
        )
        INSERT INTO doxa_theoria_observations_warm SELECT * FROM moved
      `,
      [hotRetentionDays, warmRetentionDays],
    )
    await client.query('COMMIT')
    return result.rowCount ?? 0
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function ensureWarmPartition(pool: Pool, month: Date): Promise<void> {
  const start = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1))
  const end = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1))
  const suffix = `${start.getUTCFullYear()}${String(start.getUTCMonth() + 1).padStart(2, '0')}`
  await pool.query(
    `CREATE TABLE IF NOT EXISTS doxa_theoria_observations_warm_${suffix}
       PARTITION OF doxa_theoria_observations_warm
       FOR VALUES FROM ('${start.toISOString()}') TO ('${end.toISOString()}')`,
  )
}

async function dropExpiredWarmPartitions(pool: Pool, warmRetentionDays: number): Promise<number> {
  const result = await pool.query<{ name: string }>(`
    SELECT child.relname AS name
    FROM pg_inherits
    JOIN pg_class parent ON parent.oid = inhparent
    JOIN pg_class child ON child.oid = inhrelid
    WHERE parent.relname = 'doxa_theoria_observations_warm'
  `)
  const cutoff = new Date(Date.now() - warmRetentionDays * 86_400_000)
  let dropped = 0
  for (const { name } of result.rows) {
    const match = name.match(/^doxa_theoria_observations_warm_(\d{4})(\d{2})$/)
    if (!match) continue
    const end = new Date(Date.UTC(Number(match[1]), Number(match[2]), 1))
    if (end >= cutoff) continue
    const count = await pool.query<{ count: string }>(`SELECT count(*) AS count FROM ${name}`)
    await pool.query(`DROP TABLE ${name}`)
    dropped += Number(count.rows[0]?.count ?? 0)
  }
  return dropped
}

function validateRetention(options: PostgresTheoriaOptions): void {
  if (
    options.hotRetentionDays !== undefined &&
    (!Number.isFinite(options.hotRetentionDays) || options.hotRetentionDays <= 0)
  ) {
    throw new TypeError('Theoria hotRetentionDays must be positive.')
  }
  const hotRetentionDays = options.hotRetentionDays ?? 7
  if (
    options.warmRetentionDays !== undefined &&
    (!Number.isFinite(options.warmRetentionDays) || options.warmRetentionDays <= hotRetentionDays)
  ) {
    throw new TypeError('Theoria warmRetentionDays must exceed hotRetentionDays.')
  }
  if (
    options.maximumObservations !== undefined &&
    (!Number.isSafeInteger(options.maximumObservations) || options.maximumObservations <= 0)
  ) {
    throw new TypeError('Theoria maximumObservations must be a positive safe integer.')
  }
}

function validateCapture(options: PostgresTheoriaOptions): void {
  if (
    options.sampleRate !== undefined &&
    (!Number.isFinite(options.sampleRate) || options.sampleRate < 0 || options.sampleRate > 1)
  ) {
    throw new TypeError('Theoria sampleRate must be between zero and one.')
  }
  if (
    options.minimumDurationMilliseconds !== undefined &&
    (!Number.isFinite(options.minimumDurationMilliseconds) ||
      options.minimumDurationMilliseconds < 0)
  ) {
    throw new TypeError('Theoria minimumDurationMilliseconds must be non-negative.')
  }
  if (
    options.minimumDurationMilliseconds !== undefined &&
    options.includePhases &&
    !(['started', 'completed', 'failed'] as const).every((phase) =>
      options.includePhases!.includes(phase),
    )
  ) {
    throw new TypeError(
      'Theoria duration filtering requires started, completed, and failed phases.',
    )
  }
  for (const [name, value] of [
    ['maximumPending', options.maximumPending],
    ['batchSize', options.batchSize],
    ['flushIntervalMilliseconds', options.flushIntervalMilliseconds],
    ['poolMaximum', options.poolMaximum],
  ] as const) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) {
      throw new TypeError(`Theoria ${name} must be a positive safe integer.`)
    }
  }
}
