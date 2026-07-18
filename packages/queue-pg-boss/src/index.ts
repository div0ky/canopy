import { createHash, randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { CronExpressionParser } from 'cron-parser'
import type { PoolClient } from 'pg'
import { Pool } from 'pg'
import { PgBoss, type JobWithMetadata, type SendOptions } from 'pg-boss'

import {
  type Disposes,
  type Drains,
  type LifecycleContext,
  type QueueDeliveryHandler,
  type QueueEnvelope,
  type QueueJobRecord,
  type QueueRuntimeRoles,
  QueueManager,
  type ScheduleDefinition,
  type SpanLink,
  type Starts,
  type Stops,
} from '@doxajs/core'

const QUEUE_NAME = 'doxa-jobs'
const SERIAL_SCHEDULE_QUEUE = 'doxa-schedules-serial'
const PARALLEL_SCHEDULE_QUEUE = 'doxa-schedules-parallel'
const OUTBOX_MESSAGE_TYPE = 'doxa.queue'

export interface PgBossQueueOptions {
  readonly connectionString: string
  readonly localConcurrency?: number
  readonly pollingIntervalSeconds?: number
  readonly outboxPollingMilliseconds?: number
  readonly applicationName?: string
}

export class PgBossQueueManager extends QueueManager implements Starts, Drains, Stops, Disposes {
  #boss: PgBoss | undefined
  #pool: Pool | undefined
  #handler: QueueDeliveryHandler | undefined
  #outboxTimer: NodeJS.Timeout | undefined
  #outboxWork: Promise<number> | undefined
  #workerId: string | undefined
  #scheduleWorkerIds: { readonly queue: string; readonly id: string }[] = []
  #schedules: readonly ScheduleDefinition[] = []
  #intervalTimers: NodeJS.Timeout[] = []
  #started = false
  #draining = false
  #lastEngineError: unknown
  #roles: QueueRuntimeRoles = { worker: true, scheduler: true }
  #enabledSchedules = new Set<string>()

  constructor(private readonly options: PgBossQueueOptions) {
    super()
  }

  bind(handler: QueueDeliveryHandler): void {
    if (this.#handler) throw new Error('The Doxa queue delivery handler is already bound.')
    if (this.#started) throw new Error('The Doxa queue handler must be bound before startup.')
    this.#handler = handler
  }

  override selectRoles(roles: QueueRuntimeRoles): void {
    if (this.#started) throw new Error('Doxa queue roles must be selected before startup.')
    this.#roles = { ...roles }
  }

  reconcileSchedules(schedules: readonly ScheduleDefinition[]): void {
    if (this.#started) throw new Error('Doxa schedules must be reconciled before queue startup.')
    this.#schedules = Object.freeze([...schedules])
  }

  async start(context: LifecycleContext): Promise<void> {
    if (context.signal.aborted) throw context.signal.reason
    const handler = this.#handler
    if (!handler) throw new Error('The Doxa runtime did not bind a queue delivery handler.')
    const boss = new PgBoss({
      connectionString: this.options.connectionString,
      application_name: this.options.applicationName ?? 'doxa-queue',
      createSchema: false,
      migrate: false,
      schedule: this.#roles.scheduler,
    })
    boss.on('error', (error) => {
      this.#lastEngineError = error
    })
    const pool = new Pool({
      connectionString: this.options.connectionString,
      application_name: `${this.options.applicationName ?? 'doxa-queue'}-outbox`,
    })
    try {
      await pool.query('select 1')
      await boss.start()
      await boss.createQueue(QUEUE_NAME)
      await boss.createQueue(SERIAL_SCHEDULE_QUEUE, { policy: 'singleton' })
      await boss.createQueue(PARALLEL_SCHEDULE_QUEUE)
      this.#boss = boss
      this.#pool = pool
      const workOptions = {
        includeMetadata: true,
        localConcurrency: this.options.localConcurrency ?? 2,
        pollingIntervalSeconds: this.options.pollingIntervalSeconds ?? 0.5,
      } as const
      if (this.#roles.worker)
        this.#workerId = await boss.work<QueueEnvelope, void, typeof workOptions>(
          QUEUE_NAME,
          workOptions,
          async (jobs) => {
            for (const job of jobs) {
              await handler({
                envelope: job.data,
                attempt: job.retryCount + 1,
                cancellation: job.signal,
              })
            }
          },
        )
      if (this.#roles.worker)
        for (const queue of [SERIAL_SCHEDULE_QUEUE, PARALLEL_SCHEDULE_QUEUE]) {
          const id = await boss.work<ScheduleDefinition, void, typeof workOptions>(
            queue,
            workOptions,
            async (jobs) => {
              for (const job of jobs) {
                await this.#recordScheduleAdmission(job.data.id)
                await handler({
                  envelope: scheduleEnvelope(job.id, job.data),
                  attempt: job.retryCount + 1,
                  cancellation: job.signal,
                })
              }
            },
          )
          this.#scheduleWorkerIds.push({ queue, id })
        }
      this.#started = true
      if (this.#roles.scheduler) {
        await this.#loadScheduleControls()
        await this.#reconcileMisfires()
        await this.#reconcileCronSchedules()
        await this.#startIntervalSchedules()
      }
      if (this.#roles.worker) {
        await this.flushOutbox()
        this.#scheduleOutboxPoll()
      }
    } catch (error) {
      this.#boss = undefined
      this.#pool = undefined
      await boss.stop({ graceful: false }).catch(() => undefined)
      await pool.end().catch(() => undefined)
      throw error
    }
  }

  async enqueue(envelope: QueueEnvelope): Promise<string> {
    const boss = this.#requireBoss()
    const id = await boss.send(QUEUE_NAME, envelope, sendOptions(envelope))
    if (!id) {
      const [existing] = await boss.findJobs<QueueEnvelope>(QUEUE_NAME, { id: envelope.id })
      if (!existing) throw new Error(`pg-boss rejected Doxa job ${envelope.id}.`)
    }
    return envelope.id
  }

  flushOutbox(): Promise<number> {
    if (this.#outboxWork) return this.#outboxWork
    const work = this.#flushOutbox()
    this.#outboxWork = work
    void work
      .finally(() => {
        if (this.#outboxWork === work) this.#outboxWork = undefined
      })
      .catch(() => undefined)
    return work
  }

  async findJob(id: string): Promise<QueueJobRecord | undefined> {
    const [job] = await this.#requireBoss().findJobs<QueueEnvelope>(QUEUE_NAME, { id })
    if (!job) return undefined
    return {
      id: job.id,
      state: job.state,
      retryCount: job.retryCount,
      retryLimit: job.retryLimit,
      ...(job.output === undefined ? {} : { output: job.output }),
    }
  }

  async findAttemptTrace(id: string, attempt: number): Promise<SpanLink | undefined> {
    const result = await this.#requirePool().query<{ trace_id: string; span_id: string }>(
      `SELECT trace_id, span_id FROM doxa_queue_attempt_traces
       WHERE job_id = $1 AND attempt = $2`,
      [id, attempt],
    )
    const row = result.rows[0]
    return row ? Object.freeze({ traceId: row.trace_id, spanId: row.span_id }) : undefined
  }

  async recordAttemptTrace(id: string, attempt: number, trace: SpanLink): Promise<void> {
    const pool = this.#requirePool()
    await pool.query(
      `INSERT INTO doxa_queue_attempt_traces (job_id, attempt, trace_id, span_id, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (job_id, attempt) DO UPDATE
       SET trace_id = excluded.trace_id, span_id = excluded.span_id, updated_at = now()`,
      [id, attempt, trace.traceId, trace.spanId],
    )
    await pool.query(
      `DELETE FROM doxa_queue_attempt_traces WHERE updated_at < now() - interval '30 days'`,
    )
  }

  async clearAttemptTraces(id: string): Promise<void> {
    await this.#requirePool().query('DELETE FROM doxa_queue_attempt_traces WHERE job_id = $1', [id])
  }

  async drain(_context: LifecycleContext): Promise<void> {
    if (!this.#started || this.#draining) return
    this.#draining = true
    if (this.#outboxTimer) clearTimeout(this.#outboxTimer)
    for (const timer of this.#intervalTimers.splice(0)) clearTimeout(timer)
    this.#outboxTimer = undefined
    if (this.#outboxWork) await this.#outboxWork
    if (this.#workerId) {
      await this.#requireBoss().offWork(QUEUE_NAME, {
        id: this.#workerId,
        wait: true,
      })
      this.#workerId = undefined
    }
    for (const worker of this.#scheduleWorkerIds.splice(0)) {
      await this.#requireBoss().offWork(worker.queue, { id: worker.id, wait: true })
    }
  }

  async stop(_context: LifecycleContext): Promise<void> {
    const boss = this.#boss
    this.#boss = undefined
    this.#started = false
    if (boss) await boss.stop({ graceful: true, timeout: 10_000 })
  }

  async dispose(_context: LifecycleContext): Promise<void> {
    const pool = this.#pool
    this.#pool = undefined
    if (pool) await pool.end()
  }

  get lastEngineError(): unknown {
    return this.#lastEngineError
  }

  async #reconcileCronSchedules(): Promise<void> {
    const boss = this.#requireBoss()
    const desired = new Set(
      this.#schedules
        .filter(
          (schedule) => schedule.cadence.kind === 'cron' && this.#enabledSchedules.has(schedule.id),
        )
        .map((schedule) => scheduleKey(schedule.id)),
    )
    for (const queue of [SERIAL_SCHEDULE_QUEUE, PARALLEL_SCHEDULE_QUEUE]) {
      for (const existing of await boss.getSchedules(queue)) {
        if (!desired.has(existing.key)) await boss.unschedule(queue, existing.key)
      }
    }
    for (const schedule of this.#schedules) {
      if (schedule.cadence.kind !== 'cron') continue
      if (!this.#enabledSchedules.has(schedule.id)) continue
      const queue = scheduleQueue(schedule)
      const other =
        queue === SERIAL_SCHEDULE_QUEUE ? PARALLEL_SCHEDULE_QUEUE : SERIAL_SCHEDULE_QUEUE
      const key = scheduleKey(schedule.id)
      await boss.unschedule(other, key)
      await boss.schedule(queue, schedule.cadence.expression, schedule, {
        key,
        tz: schedule.timeZone,
        retryLimit: schedule.policy.retries,
        retryDelay: schedule.policy.retryDelay,
        retryBackoff: schedule.policy.backoff,
        expireInSeconds: schedule.policy.timeout,
        ...(schedule.overlap === 'serialize' ? { singletonKey: schedule.id } : {}),
      })
    }
  }

  async #startIntervalSchedules(): Promise<void> {
    for (const schedule of this.#schedules) {
      if (schedule.cadence.kind !== 'interval') continue
      if (!this.#enabledSchedules.has(schedule.id)) continue
      await this.#armInterval(schedule)
    }
  }

  async #loadScheduleControls(): Promise<void> {
    const pool = this.#pool!
    for (const schedule of this.#schedules) {
      await pool.query(
        `INSERT INTO doxa_schedule_controls (schedule_id, enabled) VALUES ($1, true) ON CONFLICT (schedule_id) DO NOTHING`,
        [schedule.id],
      )
    }
    const result = await pool.query<{ schedule_id: string }>(
      'SELECT schedule_id FROM doxa_schedule_controls WHERE enabled = true',
    )
    this.#enabledSchedules = new Set(result.rows.map((row) => row.schedule_id))
  }

  async #reconcileMisfires(): Promise<void> {
    const pool = this.#pool!
    const boss = this.#requireBoss()
    for (const schedule of this.#schedules) {
      if (!this.#enabledSchedules.has(schedule.id)) continue
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const control = await client.query<{ last_reconciled_at: Date | null }>(
          'SELECT last_reconciled_at FROM doxa_schedule_controls WHERE schedule_id = $1 FOR UPDATE',
          [schedule.id],
        )
        const previous = control.rows[0]?.last_reconciled_at
        const now = new Date()
        const missed =
          previous && schedule.misfire === 'catch-up-once'
            ? latestOccurrence(schedule, previous, now)
            : undefined
        if (missed) {
          const id = deterministicUuid(`${schedule.id}:catch-up:${missed.toISOString()}`)
          const accepted = await boss.send(scheduleQueue(schedule), schedule, {
            id,
            retryLimit: schedule.policy.retries,
            retryDelay: schedule.policy.retryDelay,
            retryBackoff: schedule.policy.backoff,
            expireInSeconds: schedule.policy.timeout,
            ...(schedule.overlap === 'serialize' ? { singletonKey: schedule.id } : {}),
            db: databaseFor(client),
          })
          if (!accepted) {
            const existing = await client.query(
              'SELECT 1 FROM pgboss.job WHERE name = $1 AND id = $2',
              [scheduleQueue(schedule), id],
            )
            if (existing.rowCount !== 1)
              throw new Error(`pg-boss rejected Doxa schedule catch-up ${id}.`)
          }
        }
        await client.query(
          'UPDATE doxa_schedule_controls SET last_reconciled_at = $2, updated_at = now() WHERE schedule_id = $1',
          [schedule.id, now],
        )
        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined)
        throw error
      } finally {
        client.release()
      }
    }
  }

  async #recordScheduleAdmission(scheduleId: string): Promise<void> {
    await this.#pool?.query(
      `UPDATE doxa_schedule_controls
       SET last_reconciled_at = GREATEST(COALESCE(last_reconciled_at, '-infinity'::timestamptz), now()),
           updated_at = now()
       WHERE schedule_id = $1`,
      [scheduleId],
    )
  }

  async #armInterval(schedule: ScheduleDefinition): Promise<void> {
    if (schedule.cadence.kind !== 'interval' || this.#draining) return
    const milliseconds = schedule.cadence.seconds * 1_000
    const slot = Math.floor(Date.now() / milliseconds) + 1
    const fireAt = slot * milliseconds
    await this.#sendInterval(schedule, slot, fireAt)
    const timer = setTimeout(
      () => {
        this.#intervalTimers = this.#intervalTimers.filter((candidate) => candidate !== timer)
        void this.#armInterval(schedule).catch((error) => {
          this.#lastEngineError = error
        })
      },
      Math.max(1, fireAt - Date.now() + 25),
    )
    timer.unref()
    this.#intervalTimers.push(timer)
  }

  async #sendInterval(schedule: ScheduleDefinition, slot: number, fireAt: number): Promise<void> {
    const id = deterministicUuid(`${schedule.id}:${slot}`)
    await this.#requireBoss().send(scheduleQueue(schedule), schedule, {
      id,
      startAfter: new Date(fireAt),
      retryLimit: schedule.policy.retries,
      retryDelay: schedule.policy.retryDelay,
      retryBackoff: schedule.policy.backoff,
      expireInSeconds: schedule.policy.timeout,
      ...(schedule.overlap === 'serialize' ? { singletonKey: schedule.id } : {}),
    })
  }

  async #flushOutbox(): Promise<number> {
    const pool = this.#pool
    const boss = this.#boss
    if (!pool || !boss || this.#draining) return 0
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const result = await client.query<{
        id: string
        payload: QueueEnvelope
      }>(
        `
        SELECT id, payload
        FROM doxa_outbox_messages
        WHERE status = 'pending'
          AND message_type = $1
          AND available_at <= now()
        ORDER BY available_at, created_at
        FOR UPDATE SKIP LOCKED
        LIMIT 50
      `,
        [OUTBOX_MESSAGE_TYPE],
      )
      const database = databaseFor(client)
      for (const row of result.rows) {
        const id = await boss.send(QUEUE_NAME, row.payload, {
          ...sendOptions(row.payload),
          db: database,
        })
        if (!id) {
          const existing = await client.query(
            `
            SELECT 1 FROM pgboss.job WHERE name = $1 AND id = $2
          `,
            [QUEUE_NAME, row.payload.id],
          )
          if (existing.rowCount !== 1) {
            throw new Error(`pg-boss rejected outbox job ${row.payload.id}.`)
          }
        }
        await client.query(
          `
          UPDATE doxa_outbox_messages
          SET status = 'dispatched'
          WHERE id = $1
        `,
          [row.id],
        )
      }
      await client.query('COMMIT')
      return result.rowCount ?? 0
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  #scheduleOutboxPoll(): void {
    if (this.#draining || !this.#started) return
    this.#outboxTimer = setTimeout(() => {
      void this.flushOutbox()
        .catch((error) => {
          this.#lastEngineError = error
        })
        .finally(() => this.#scheduleOutboxPoll())
    }, this.options.outboxPollingMilliseconds ?? 100)
    this.#outboxTimer.unref()
  }

  #requireBoss(): PgBoss {
    if (!this.#boss) throw new Error('The Doxa pg-boss queue manager is not started.')
    return this.#boss
  }

  #requirePool(): Pool {
    if (!this.#pool) throw new Error('The Doxa pg-boss queue manager is not started.')
    return this.#pool
  }
}

export async function installQueueSchema(connectionString: string): Promise<void> {
  const boss = new PgBoss({ connectionString, schedule: false })
  await boss.start()
  await boss.stop({ graceful: true })
  const pool = new Pool({ connectionString })
  try {
    const directory = new URL('../migrations/', import.meta.url)
    const migrations = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort()
    for (const migration of migrations) {
      await pool.query(await readFile(new URL(migration, directory), 'utf8'))
    }
  } finally {
    await pool.end()
  }
}

export async function inspectQueueJob(
  connectionString: string,
  id: string,
): Promise<QueueJobRecord | undefined> {
  const pool = new Pool({ connectionString })
  try {
    const result = await pool.query<{
      id: string
      state: QueueJobRecord['state']
      retry_count: number
      retry_limit: number
      output: unknown
    }>(
      `
      SELECT id, state, retry_count, retry_limit, output
      FROM pgboss.job
      WHERE name = $1 AND id = $2
    `,
      [QUEUE_NAME, id],
    )
    const job = result.rows[0]
    if (!job) return undefined
    return {
      id: job.id,
      state: job.state,
      retryCount: job.retry_count,
      retryLimit: job.retry_limit,
      ...(job.output === null ? {} : { output: job.output }),
    }
  } finally {
    await pool.end()
  }
}

export async function clearQueueJobs(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString })
  try {
    await pool.query('DELETE FROM doxa_queue_attempt_traces')
    await pool.query('DELETE FROM pgboss.job WHERE name = ANY($1)', [
      [QUEUE_NAME, SERIAL_SCHEDULE_QUEUE, PARALLEL_SCHEDULE_QUEUE],
    ])
  } finally {
    await pool.end()
  }
}

export async function listQueueJobs(
  connectionString: string,
  state?: QueueJobRecord['state'],
): Promise<readonly QueueJobRecord[]> {
  const pool = new Pool({ connectionString })
  try {
    const result = await pool.query<{
      id: string
      state: QueueJobRecord['state']
      retry_count: number
      retry_limit: number
      output: unknown
    }>(
      `
      SELECT id, state, retry_count, retry_limit, output
      FROM pgboss.job
      WHERE name = $1 AND ($2::text IS NULL OR state::text = $2::text)
      ORDER BY created_on DESC LIMIT 100
    `,
      [QUEUE_NAME, state ?? null],
    )
    return result.rows.map((job) => ({
      id: job.id,
      state: job.state,
      retryCount: job.retry_count,
      retryLimit: job.retry_limit,
      ...(job.output === null ? {} : { output: job.output }),
    }))
  } finally {
    await pool.end()
  }
}

export async function retryQueueJob(connectionString: string, id: string): Promise<void> {
  const job = await inspectQueueJob(connectionString, id)
  if (!job || job.state !== 'failed')
    throw new Error(`Only a failed Doxa queue job may be retried: ${id}.`)
  await queueCommand(connectionString, (boss) => boss.retry(QUEUE_NAME, id))
}

export async function cancelQueueJob(connectionString: string, id: string): Promise<void> {
  const job = await inspectQueueJob(connectionString, id)
  if (!job || !['created', 'retry', 'active'].includes(job.state))
    throw new Error(`Only a pending or active Doxa queue job may be cancelled: ${id}.`)
  await queueCommand(connectionString, (boss) => boss.cancel(QUEUE_NAME, id))
}

async function queueCommand(
  connectionString: string,
  command: (boss: PgBoss) => Promise<unknown>,
): Promise<void> {
  const boss = new PgBoss({
    connectionString,
    createSchema: false,
    migrate: false,
    schedule: false,
  })
  try {
    await boss.start()
    await command(boss)
  } finally {
    await boss.stop({ graceful: true }).catch(() => undefined)
  }
}

function sendOptions(envelope: QueueEnvelope): SendOptions {
  return {
    id: envelope.id,
    retryLimit: envelope.policy.retries,
    retryDelay: envelope.policy.retryDelay,
    retryBackoff: envelope.policy.backoff,
    expireInSeconds: envelope.policy.timeout,
    ...(envelope.availableAt ? { startAfter: new Date(envelope.availableAt) } : {}),
  }
}

function scheduleQueue(schedule: ScheduleDefinition): string {
  return schedule.overlap === 'serialize' ? SERIAL_SCHEDULE_QUEUE : PARALLEL_SCHEDULE_QUEUE
}

function scheduleKey(id: string): string {
  return id.replace(':', '/')
}

function scheduleEnvelope(id: string, schedule: ScheduleDefinition): QueueEnvelope {
  return {
    id,
    kind: 'job',
    targetId: schedule.targetId,
    scheduleId: schedule.id,
    payload: schedule.input,
    policy: schedule.policy,
    context: {
      version: 1,
      sourceExecutionId: id,
      correlationId: id,
      causationId: schedule.id,
      actor: { kind: 'system', id: 'doxa:scheduler' },
      initiator: { kind: 'system', id: 'doxa:scheduler' },
      delegation: [],
      authentication: {
        state: 'authenticated',
        identityId: 'doxa:scheduler',
        method: 'schedule',
      },
      trace: {},
      timeZone: schedule.timeZone,
    },
  }
}

function deterministicUuid(value: string): string {
  const hex = createHash('sha256').update(value).digest('hex').slice(0, 32).split('')
  hex[12] = '5'
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16)
  const joined = hex.join('')
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20)}`
}

function latestOccurrence(
  schedule: ScheduleDefinition,
  after: Date,
  through: Date,
): Date | undefined {
  if (schedule.cadence.kind === 'interval') {
    const milliseconds = schedule.cadence.seconds * 1_000
    const occurrence = new Date(Math.floor(through.getTime() / milliseconds) * milliseconds)
    return occurrence > after ? occurrence : undefined
  }
  const occurrence = CronExpressionParser.parse(schedule.cadence.expression, {
    currentDate: through,
    tz: schedule.timeZone,
  })
    .prev()
    .toDate()
  return occurrence > after ? occurrence : undefined
}

function databaseFor(client: PoolClient) {
  return {
    executeSql: async (text: string, values?: unknown[]) => {
      const result = await client.query(text, values)
      return { rows: result.rows }
    },
  }
}
