import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createHmac, randomUUID, sign } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { compileApplication } from '@canopy/compiler'
import { runArbor } from '@canopy/arbor'
import { installAuthSchema, PostgresAuth } from '@canopy/auth-postgres'
import {
  AfterCommitError,
  AuthorizationError,
  type ActionClass,
  type ExecutionContext,
  DetachedModelError,
  EventDispatchError,
  SignalDispatchError,
  ModelNotFoundError,
  OptimisticConcurrencyError,
  ObservationRecorder,
  ReadOnlyExecutionError,
  StaleUnitOfWorkError,
  StaleModelError,
  type UnitOfWork,
} from '@canopy/core'
import {
  installPersistenceSchema,
  installCacheSchema,
  installCommunicationsSchema,
  PostgresTransactionManager,
} from '@canopy/postgres-drizzle'
import {
  clearQueueJobs,
  inspectQueueJob,
  installQueueSchema,
} from '@canopy/queue-pg-boss'
import { HonoHttpEngine, HonoHttpHost } from '@canopy/http-hono'
import { Canopy, type CanopyRuntime } from '@canopy/runtime'
import { installUndergrowthSchema, listenUndergrowth, pruneUndergrowth, UndergrowthStore } from '@canopy/undergrowth'
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql'
import { Pool } from 'pg'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest'

import { Application } from '../examples/persistence-app/dist/application.js'
import { AttemptCounterWrite } from '../examples/persistence-app/dist/counters/queries/attempt-counter-write.js'
import {
  capturedCounter,
  CaptureCounter,
  resetCapturedCounter,
} from '../examples/persistence-app/dist/counters/actions/capture-counter.js'
import { Counter } from '../examples/persistence-app/dist/counters/models/counter.js'
import { HttpPinged } from '../examples/persistence-app/dist/system/events/http-pinged.js'
import { CreateCounter } from '../examples/persistence-app/dist/counters/actions/create-counter.js'
import { DeleteCounter } from '../examples/persistence-app/dist/counters/actions/delete-counter.js'
import { DispatchProcessCounter } from '../examples/persistence-app/dist/counters/actions/dispatch-process-counter.js'
import { DispatchCounterSignal } from '../examples/persistence-app/dist/counters/actions/dispatch-counter-signal.js'
import { ExerciseCache } from '../examples/persistence-app/dist/counters/actions/exercise-cache.js'
import { QueueNotifications } from '../examples/persistence-app/dist/counters/actions/queue-notifications.js'
import { CounterTouched } from '../examples/persistence-app/dist/counters/signals/counter-touched.js'
import {
  recordedEvents,
  resetRecordedEvents,
} from '../examples/persistence-app/dist/support/recorded-events.js'
import { SaveDetachedCounter } from '../examples/persistence-app/dist/counters/actions/save-detached-counter.js'
import { InspectCounter } from '../examples/persistence-app/dist/counters/actions/inspect-counter.js'
import { RefreshCounter } from '../examples/persistence-app/dist/counters/actions/refresh-counter.js'
import { RenameCounter } from '../examples/persistence-app/dist/counters/actions/rename-counter.js'
import { SaveCounter } from '../examples/persistence-app/dist/counters/actions/save-counter.js'
import { SaveLegacyCustomer } from '../examples/persistence-app/dist/counters/actions/save-legacy-customer.js'
import { DeleteLegacyCustomer } from '../examples/persistence-app/dist/counters/actions/delete-legacy-customer.js'
import { SaveLegacyNote } from '../examples/persistence-app/dist/counters/actions/save-legacy-note.js'
import { RequestCounterNotification } from '../examples/persistence-app/dist/counters/actions/request-counter-notification.js'
import {
  recordedJobAttempts,
  resetRecordedJobAttempts,
} from '../examples/persistence-app/dist/support/job-attempts.js'
import {
  observerLog,
  resetObserverLog,
} from '../examples/persistence-app/dist/support/observer-log.js'
import { commandLog, resetCommandLog } from '../examples/persistence-app/dist/support/command-log.js'
import { resetTelemetryRecords, telemetryRecords } from '../examples/persistence-app/dist/infrastructure/telemetry/reference-telemetry.js'

const workspace = path.resolve(import.meta.dirname, '..')
const sendGridPrivateKey = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg9rNr2WgnO55k28GU
JyCQ1cUBXbNHp5Ba6ldsRer+rumhRANCAAR40qEx8EcrITxkne2G32ahC4rBpIMQ
r1VdQZCF0idMzC/BYZVlgcTaRWyiIVcT4am1YWDiE8z7XwLpReB9V3aH
-----END PRIVATE KEY-----
`
const sendGridPublicKey = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEeNKhMfBHKyE8ZJ3tht9moQuKwaSD
EK9VXUGQhdInTMwvwWGVZYHE2kVsoiFXE+GptWFg4hPM+18C6UXgfVd2hw==
-----END PUBLIC KEY-----
`
const twilioAuthToken = 'test-twilio-auth-token'
const persistenceApplication = path.join(workspace, 'examples/persistence-app')
const temporaryDirectories: string[] = []
const runtimes: CanopyRuntime[] = []
const hosts: HonoHttpHost[] = []
let container: StartedPostgreSqlContainer
let connectionString: string
let pool: Pool
let executionSequence = 0

describe('PostgreSQL and Drizzle persistence slice', () => {
  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start()
    connectionString = container.getConnectionUri()
    await installPersistenceSchema(connectionString)
    await installCacheSchema(connectionString)
    await installCommunicationsSchema(connectionString)
    await installAuthSchema(connectionString)
    await installQueueSchema(connectionString)
    await installUndergrowthSchema(connectionString)
    pool = new Pool({ connectionString })
    await pool.query(`
      CREATE TABLE legacy_customers (
        customer_id text PRIMARY KEY,
        full_name text NOT NULL,
        enabled boolean NOT NULL,
        lock_version integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `)
    await pool.query(`
      CREATE TABLE legacy_auth_users (
        external_id text PRIMARY KEY,
        email_address text NOT NULL UNIQUE,
        verified_at timestamptz,
        created_on timestamptz NOT NULL,
        updated_on timestamptz NOT NULL,
        password_record text NOT NULL
      )
    `)
    await pool.query(`CREATE TABLE legacy_notes (id text PRIMARY KEY, body text NOT NULL)`)
  })

  beforeEach(async () => {
    resetCapturedCounter()
    resetRecordedEvents()
    resetRecordedJobAttempts()
    resetObserverLog()
    resetCommandLog()
    resetTelemetryRecords()
    await clearQueueJobs(connectionString)
    await pool.query(`
      TRUNCATE
        canopy_auth_audit_events,
        canopy_auth_rate_limits,
        canopy_auth_challenges,
        canopy_auth_access_tokens,
        canopy_auth_sessions,
        canopy_auth_passwords,
        canopy_auth_identities,
        canopy_outbox_messages,
        canopy_journal_entries,
        canopy_entity_states
        , canopy_cache_entries,
        canopy_delivery_events,
        canopy_delivery_messages
        , legacy_customers
        , legacy_auth_users
        , legacy_notes
        , canopy_undergrowth_observations
    `)
  })

  afterEach(async () => {
    await Promise.all(hosts.splice(0).map((host) => host.shutdown()))
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.shutdown()))
    await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
      recursive: true,
      force: true,
    })))
  })

  afterAll(async () => {
    await pool?.end()
    await container?.stop()
  })

  it('compiles Unit of Work and transaction capabilities without engine types', async () => {
    const result = await compilePersistenceApplication(await temporaryDirectory())
    expect(result.manifest.providers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'provider:infrastructure/transactions',
        capabilities: ['transactions'],
        scope: 'singleton',
      }),
      expect.objectContaining({
        id: 'provider:infrastructure/queues',
        capabilities: ['queues'],
        scope: 'singleton',
      }),
      expect.objectContaining({
        id: 'provider:infrastructure/auth',
        capabilities: ['authentication'],
        scope: 'singleton',
      }),
      expect.objectContaining({
        id: 'provider:infrastructure/cache',
        capabilities: ['cache'],
        scope: 'singleton',
      }),
      expect.objectContaining({ id: 'provider:infrastructure/mail', capabilities: ['mail'] }),
      expect.objectContaining({ id: 'provider:infrastructure/sms', capabilities: ['sms'] }),
      expect.objectContaining({ id: 'provider:infrastructure/telemetry', capabilities: ['telemetry'] }),
      expect.objectContaining({ id: 'provider:infrastructure/undergrowth', capabilities: ['observations'] }),
      expect.objectContaining({
        id: 'provider:counters/counter-event-recorder',
        capabilities: [],
        scope: 'singleton',
      }),
      expect.objectContaining({
        id: 'provider:system/system-event-recorder',
        capabilities: [],
        scope: 'singleton',
      }),
    ]))
    expect(result.manifest.configurations.find((configuration) => configuration.name === 'DatabaseConfig')?.properties).toEqual([
      expect.objectContaining({
        name: 'connectionString',
        kind: 'secret-string',
        sensitive: true,
      }),
    ])
    expect(result.manifest.actions.find((action) => action.id === 'action:counters/exercise-cache'))
      .toEqual(expect.objectContaining({
        dependencies: [expect.objectContaining({ targetId: 'provider:infrastructure/cache' })],
      }))
    expect(result.manifest.models).toEqual([
      expect.objectContaining({
        id: 'model:counters/counter',
        entityType: 'model:counters/counter',
        storage: { kind: 'entity-state' },
      }),
      expect.objectContaining({
        id: 'model:counters/legacy-customer',
        entityType: 'model:counters/legacy-customer',
        storage: {
          kind: 'table',
          table: 'legacy_customers',
          primaryKey: 'customer_id',
          versionColumn: 'lock_version',
          timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
          columns: { id: 'customer_id', displayName: 'full_name', active: 'enabled' },
        },
      }),
      expect.objectContaining({
        id: 'model:counters/legacy-note',
        storage: {
          kind: 'table',
          table: 'legacy_notes',
          primaryKey: 'id',
          columns: { id: 'id' },
          timestamps: false,
        },
      }),
    ])
    expect(result.manifest.routes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'route:accounts/change-password', method: 'POST', path: '/auth/password',
      }),
      expect.objectContaining({
        id: 'route:accounts/issue-access-token',
        method: 'POST',
        path: '/auth/tokens',
      }),
      expect.objectContaining({
        id: 'route:accounts/list-access-tokens',
        method: 'GET',
        path: '/auth/tokens',
      }),
      expect.objectContaining({ id: 'route:accounts/list-sessions', method: 'GET', path: '/auth/sessions' }),
      expect.objectContaining({
        id: 'route:accounts/login',
        method: 'POST',
        path: '/auth/login',
      }),
      expect.objectContaining({
        id: 'route:accounts/logout',
        method: 'POST',
        path: '/auth/logout',
      }),
      expect.objectContaining({
        id: 'route:accounts/me',
        method: 'GET',
        path: '/auth/me',
      }),
      expect.objectContaining({
        id: 'route:accounts/register',
        method: 'POST',
        path: '/auth/register',
      }),
      expect.objectContaining({
        id: 'route:accounts/request-password-reset', method: 'POST', path: '/auth/password/forgot',
      }),
      expect.objectContaining({ id: 'route:accounts/resend-verification', method: 'POST', path: '/auth/email/verification' }),
      expect.objectContaining({
        id: 'route:accounts/reset-password', method: 'POST', path: '/auth/password/reset',
      }),
      expect.objectContaining({
        id: 'route:accounts/revoke-access-token',
        method: 'DELETE',
        path: '/auth/tokens/:id',
      }),
      expect.objectContaining({ id: 'route:accounts/revoke-session', method: 'DELETE', path: '/auth/sessions/:id' }),
      expect.objectContaining({
        id: 'route:accounts/rotate-access-token',
        method: 'POST',
        path: '/auth/tokens/:id/rotate',
      }),
      expect.objectContaining({
        id: 'route:accounts/verify-email', method: 'POST', path: '/auth/email/verify',
      }),
      expect.objectContaining({
        id: 'route:counters/delete-counter',
        method: 'DELETE',
        path: '/counters/:id',
      }),
      expect.objectContaining({
        id: 'route:counters/increment-counter',
        method: 'POST',
        path: '/counters/:id/increment',
      }),
      expect.objectContaining({
        id: 'route:counters/secure-increment-counter',
        method: 'POST',
        path: '/secure/counters/:id/increment',
        access: 'counters.write',
      }),
      expect.objectContaining({
        id: 'route:infrastructure/sendgrid-webhook',
        method: 'POST',
        path: '/webhooks/sendgrid',
      }),
      expect.objectContaining({
        id: 'route:infrastructure/twilio-sms-webhook',
        method: 'POST',
        path: '/webhooks/twilio/sms',
      }),
      expect.objectContaining({
        id: 'route:system/health',
        method: 'GET',
        path: '/health',
      }),
      expect.objectContaining({
        id: 'route:system/hello',
        method: 'GET',
        path: '/hello/:name',
      }),
      expect.objectContaining({
        id: 'route:system/home',
        method: 'GET',
        path: '/',
      }),
      expect.objectContaining({
        id: 'route:system/ping',
        method: 'POST',
        path: '/ping',
      }),
    ]))
    expect(result.manifest.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'event:accounts/user-logged-in',
        dispatch: 'immediate',
      }),
      expect.objectContaining({
        id: 'event:accounts/user-registered',
        dispatch: 'immediate',
      }),
      expect.objectContaining({
        id: 'event:counters/counter-incremented',
        dispatch: 'immediate',
      }),
      expect.objectContaining({
        id: 'event:counters/counter-notification-requested',
        dispatch: 'immediate',
      }),
      expect.objectContaining({
        id: 'event:counters/counter-saved',
        dispatch: 'after-commit',
      }),
      expect.objectContaining({
        id: 'event:system/http-pinged',
        dispatch: 'immediate',
      }),
    ]))
    expect(result.manifest.listeners).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'listener:counters/record-counter-incremented',
        eventId: 'event:counters/counter-incremented',
        delivery: 'local',
      }),
      expect.objectContaining({
        id: 'listener:counters/record-counter-incremented-after-commit',
        eventId: 'event:counters/counter-incremented',
        delivery: 'after-commit',
      }),
      expect.objectContaining({
        id: 'listener:counters/record-counter-saved',
        eventId: 'event:counters/counter-saved',
        delivery: 'local',
      }),
      expect.objectContaining({
        id: 'listener:counters/record-counter-notification',
        eventId: 'event:counters/counter-notification-requested',
        delivery: 'queued',
      }),
    ]))
    expect(result.manifest.jobs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'job:counters/process-counter',
        retries: 2,
        retryDelay: 0,
        backoff: false,
        timeout: 10,
      }),
    ]))
    expect(result.manifest.schedules).toEqual([
      expect.objectContaining({
        id: 'schedule:counters/process-counters',
        jobId: 'job:counters/process-counter',
        cadence: { kind: 'interval', seconds: 3_600 },
        timeZone: 'UTC',
        overlap: 'serialize',
        misfire: 'skip',
        input: { key: 'scheduled-counter-sweep' },
      }),
      expect.objectContaining({
        id: 'schedule:system/daily-health-check',
        jobId: 'job:counters/process-counter',
        cadence: { kind: 'cron', expression: '0 6 * * *' },
        timeZone: 'America/Chicago',
      }),
    ])
    expect(result.manifest.policies).toEqual([
      expect.objectContaining({
        id: 'policy:accounts/account',
        abilities: ['accounts.email.verify', 'accounts.logout', 'accounts.password.change', 'accounts.sessions.manage', 'accounts.tokens.manage', 'accounts.view-self'],
      }),
      expect.objectContaining({
        id: 'policy:counters/counter',
        abilities: ['counters.update', 'counters.write'],
      }),
    ])
    expect(result.manifest.signals).toEqual([
      expect.objectContaining({
        id: 'signal:counters/counter-touched',
      }),
    ])
    expect(result.manifest.signalHandlers).toEqual([
      expect.objectContaining({
        id: 'signal-handler:counters/record-counter-touched',
        signalId: 'signal:counters/counter-touched',
        access: 'public',
      }),
    ])
    expect(result.manifest.observers).toEqual([
      expect.objectContaining({
        id: 'observer:counters/counter',
        modelId: 'model:counters/counter',
        phases: [
          'retrieved', 'saving', 'creating', 'updating',
          'created', 'updated', 'saved', 'committed',
        ],
      }),
    ])
    expect(result.manifest.commands).toEqual([
      expect.objectContaining({
        id: 'command:system/describe-canopy',
        command: 'canopy:describe',
        access: 'public',
      }),
    ])
    expect(JSON.stringify(result.manifest)).not.toContain('drizzle')
    expect(JSON.stringify(result.manifest)).not.toContain('node-postgres')
    expect(JSON.stringify(result.manifest)).not.toContain('pg-boss')
  })

  it('records correlated typed observations and exposes a read-only execution timeline', async () => {
    const runtime = await bootPersistenceRuntime()
    const http = new HonoHttpEngine(runtime)
    expect((await http.fetch(new Request('http://canopy.test/health'))).status).toBe(200)

    await waitFor(async () => Number((await pool.query('SELECT count(*) AS count FROM canopy_undergrowth_observations')).rows[0]?.count) >= 4)
    const store = new UndergrowthStore(connectionString)
    try {
      const executions = await store.executions({ kind: 'execution' })
      expect(executions[0]).toEqual(expect.objectContaining({ name: 'GET /health', phase: 'completed' }))
      const timeline = await store.timeline(executions[0]!.executionId)
      expect(timeline.map((entry) => [entry.kind, entry.phase])).toEqual(expect.arrayContaining([
        ['execution', 'started'], ['http', 'started'], ['http', 'completed'], ['execution', 'completed'],
      ]))
      expect(new Set(timeline.map((entry) => entry.context.correlationId)).size).toBe(1)
      expect(timeline.every((entry) => entry.context.executionId === executions[0]!.executionId)).toBe(true)
    } finally { await store.close() }
  })

  it('browses actual terminal observations for category tabs instead of their parent executions', async () => {
    const executionId = randomUUID()
    const correlationId = randomUUID()
    const eventId = 'event:system/example-happened'
    await pool.query(`
      INSERT INTO canopy_undergrowth_observations
        (id, occurred_at, kind, name, phase, role_id, execution_id, correlation_id, transport, attributes)
      VALUES
        ($1, now(), 'execution', 'GET /example', 'completed', NULL, $2, $3, 'http', '{}'::jsonb),
        ($4, now() + interval '1 millisecond', 'event', $5, 'started', $5, $2, $3, 'http', '{}'::jsonb),
        ($6, now() + interval '2 milliseconds', 'event', $5, 'completed', $5, $2, $3, 'http', '{}'::jsonb)
    `, [randomUUID(), executionId, correlationId, randomUUID(), eventId, randomUUID()])
    const store = new UndergrowthStore(connectionString)
    try {
      expect(await store.entries({ kind: 'event' })).toEqual([
        expect.objectContaining({
          executionId,
          kind: 'event',
          name: eventId,
          phase: 'completed',
          roleId: eventId,
        }),
      ])
    } finally { await store.close() }
  })

  it('links queued worker executions back to their source execution and correlation', async () => {
    const runtime = await bootPersistenceRuntime()
    await runAction(runtime, DispatchProcessCounter, { key: `undergrowth-${randomUUID()}` })
    await waitFor(async () => (await pool.query(`
      SELECT 1 FROM canopy_undergrowth_observations
      WHERE kind = 'execution' AND transport = 'job' AND phase = 'completed'
        AND source_execution_id IS NOT NULL
    `)).rowCount === 1)
    const result = await pool.query<{
      execution_id: string; source_execution_id: string; correlation_id: string
    }>(`
      SELECT execution_id, source_execution_id, correlation_id
      FROM canopy_undergrowth_observations
      WHERE kind = 'execution' AND transport = 'job' AND phase = 'completed'
      ORDER BY sequence DESC LIMIT 1
    `)
    const worker = result.rows[0]!
    expect(worker.execution_id).not.toBe(worker.source_execution_id)
    expect(worker.correlation_id).toBe(worker.source_execution_id)
    expect((await pool.query(`
      SELECT 1 FROM canopy_undergrowth_observations
      WHERE execution_id = $1 AND correlation_id = $2
    `, [worker.source_execution_id, worker.correlation_id])).rowCount).toBeGreaterThan(0)
  })

  it('keeps application execution independent from observation recorder failure', async () => {
    const artifactsDirectory = await temporaryDirectory()
    await compilePersistenceApplication(artifactsDirectory)
    const runtime = await Canopy.boot(Application, {
      artifactsDirectory,
      dotenvPath: false,
      environment: {
        DATABASE_CONNECTION_STRING: connectionString,
        COMMUNICATIONS_SEND_GRID_WEBHOOK_PUBLIC_KEY: sendGridPublicKey,
        COMMUNICATIONS_TWILIO_AUTH_TOKEN: twilioAuthToken,
      },
      providerOverrides: { 'provider:infrastructure/undergrowth': new FailingObservationRecorder() },
    })
    runtimes.push(runtime)
    const response = await new HonoHttpEngine(runtime).fetch(new Request('http://canopy.test/health'))
    expect(response.status).toBe(200)
    expect(await responseData(response)).toEqual({ status: 'ok' })
  })

  it('prunes Undergrowth deterministically by count and age', async () => {
    for (let index = 0; index < 4; index += 1) {
      await pool.query(`
        INSERT INTO canopy_undergrowth_observations
          (id, occurred_at, kind, name, phase, attributes)
        VALUES ($1, now() + ($2::integer * interval '1 millisecond'), 'log', $3, 'occurred', '{}'::jsonb)
      `, [randomUUID(), index, `entry-${index}`])
    }
    expect(await pruneUndergrowth(connectionString, { retentionDays: 7, maximumObservations: 2 })).toBe(2)
    expect(Number((await pool.query('SELECT count(*) AS count FROM canopy_undergrowth_observations')).rows[0]?.count)).toBe(2)
    await pool.query(`UPDATE canopy_undergrowth_observations SET occurred_at = now() - interval '8 days' WHERE name = 'entry-2'`)
    expect(await pruneUndergrowth(connectionString, { retentionDays: 7, maximumObservations: 10 })).toBe(1)
  })

  it('serves the read-only Undergrowth explorer from its dedicated loopback host', async () => {
    const host = await listenUndergrowth({ connectionString, port: 0 })
    try {
      const page = await fetch(host.url)
      expect(page.status).toBe(200)
      const html = await page.text()
      expect(html).toContain('Everything beneath your Canopy')
      expect(html).toContain('.filters{flex:0 0 auto')
      expect(html).toContain('.scroll{flex:1 1 auto}')
      expect(await (await fetch(new URL('/api/health', host.url))).json()).toEqual({
        ok: true, data: { service: 'undergrowth' },
      })
      expect((await fetch(new URL('/api/executions', host.url))).headers.get('cache-control')).toBe('no-store')
      expect((await fetch(new URL('/api/entries?kind=event', host.url))).status).toBe(200)
      expect((await fetch(new URL('/api/entries', host.url))).status).toBe(400)
      expect((await fetch(new URL('/api/executions', host.url), { method: 'POST' })).status).toBe(405)
    } finally { await host.shutdown() }
    await expect(listenUndergrowth({ connectionString, host: '0.0.0.0', port: 0 }))
      .rejects.toThrow('loopback only')
  })

  it('commits entity state, journal, outbox, and causal metadata atomically', async () => {
    const runtime = await bootPersistenceRuntime()
    const result = await runtime.admit({
      actor: { kind: 'user', id: 'actor-42' },
      initiator: { kind: 'service', id: 'importer-7' },
      tenant: { id: 'tenant-3' },
      correlationId: 'correlation-1',
      causationId: 'request-9',
      transport: { kind: 'test' },
    }, (context) => runtime.actions.execute(SaveCounter, {
      id: 'counter-1',
      amount: 2,
    }).then((saved) => ({ context, saved })))

    expect(result.saved).toEqual({
      id: 'counter-1',
      value: 2,
      version: 1,
      originalValue: undefined,
      changes: { id: 'counter-1', value: 2 },
      dirtyBeforeSave: true,
      cleanAfterSave: true,
      wasChanged: true,
      exists: true,
      recentlyCreated: true,
    })
    const entity = await pool.query<{
      state: { value: number }
      version: number
    }>(`SELECT state, version FROM canopy_entity_states WHERE entity_id = 'counter-1'`)
    const journal = await pool.query<{
      fact_type: string
      context: Record<string, unknown>
    }>('SELECT fact_type, context FROM canopy_journal_entries')
    const outbox = await pool.query<{
      message_type: string
      status: string
      context: Record<string, unknown>
    }>('SELECT message_type, status, context FROM canopy_outbox_messages')

    expect(entity.rows).toEqual([{ state: { id: 'counter-1', value: 2 }, version: 1 }])
    expect(journal.rows).toEqual([expect.objectContaining({ fact_type: 'counter.incremented' })])
    expect(outbox.rows).toEqual([expect.objectContaining({
      message_type: 'counter.changed',
      status: 'pending',
    })])
    for (const durable of [journal.rows[0]!.context, outbox.rows[0]!.context]) {
      expect(durable).toEqual({
        executionId: result.context.executionId,
        correlationId: 'correlation-1',
        causationId: 'request-9',
        actor: { kind: 'user', id: 'actor-42' },
        initiator: { kind: 'service', id: 'importer-7' },
        tenant: { id: 'tenant-3' },
        trace: result.context.trace,
      })
    }
  })

  it('rolls back entity state, journal, outbox, and after-commit work together', async () => {
    const runtime = await bootPersistenceRuntime()
    await expect(runtime.admit({
      actor: { kind: 'system', id: 'rollback-test' },
      transport: { kind: 'test' },
    }, () => runtime.actions.execute(SaveCounter, {
      id: 'counter-rollback',
      amount: 5,
      failAfterWrites: true,
    }))).rejects.toThrow('failed after persistence writes')

    expect(await durableRowCounts()).toEqual({ entities: 0, journal: 0, outbox: 0 })
  })

  it('dispatches local and after-commit class listeners from model behavior in order', async () => {
    const runtime = await bootPersistenceRuntime()
    await runtime.admit({
      actor: { kind: 'user', id: 'event-user' },
      correlationId: 'event-success',
      transport: { kind: 'test' },
    }, () => runtime.actions.execute(SaveCounter, {
      id: 'event-counter',
      amount: 2,
    }))

    expect(recordedEvents).toEqual([
      {
        event: 'counter-incremented',
        phase: 'local',
        correlationId: 'event-success',
        actor: 'user',
        value: 2,
      },
      {
        event: 'counter-incremented',
        phase: 'after-commit',
        correlationId: 'event-success',
        actor: 'user',
        value: 2,
      },
      {
        event: 'counter-saved',
        phase: 'after-commit',
        correlationId: 'event-success',
        actor: 'user',
        value: 2,
      },
    ])
  })

  it('discards after-commit event work on rollback and propagates local listener failures', async () => {
    const runtime = await bootPersistenceRuntime()
    await expect(runtime.admit({
      actor: { kind: 'system', id: 'event-rollback' },
      correlationId: 'event-rollback',
      transport: { kind: 'test' },
    }, () => runtime.actions.execute(SaveCounter, {
      id: 'event-rollback',
      amount: 2,
      failAfterWrites: true,
    }))).rejects.toThrow('failed after persistence writes')
    expect(recordedEvents).toEqual([
      expect.objectContaining({ phase: 'local', correlationId: 'event-rollback' }),
    ])
    expect(await durableRowCounts()).toEqual({ entities: 0, journal: 0, outbox: 0 })

    resetRecordedEvents()
    await expect(runAction(runtime, SaveCounter, { id: 'rejected-event', amount: 13 }))
      .rejects.toThrow('Unlucky counter increments are rejected locally.')
    expect(recordedEvents).toEqual([])
    expect(await durableRowCounts()).toEqual({ entities: 0, journal: 0, outbox: 0 })
  })

  it('dispatches declared signals immediately inside the current execution', async () => {
    const runtime = await bootPersistenceRuntime()
    await runtime.admit({
      actor: { kind: 'user', id: 'signal-user' },
      correlationId: 'signal-correlation',
      transport: { kind: 'test' },
    }, () => runtime.actions.execute(DispatchCounterSignal, { counterId: 'counter-7' }))

    expect(recordedEvents).toEqual([{
      event: 'counter-touched:counter-7',
      phase: 'signal',
      correlationId: 'signal-correlation',
      actor: 'user',
    }])
  })

  it('injects the application cache with atomic add, increment, TTL, and remember semantics', async () => {
    const runtime = await bootPersistenceRuntime()
    const result = await runAction(runtime, ExerciseCache, 'cache-proof')
    expect(result).toEqual({
      added: true,
      duplicateAdded: false,
      incremented: 3,
      remembered: 'computed',
    })
  })

  it('stages mail and SMS atomically and delivers them through queued transports', async () => {
    const runtime = await bootPersistenceRuntime()
    const result = await runAction(runtime, QueueNotifications, undefined)
    await waitFor(async () => {
      const rows = await pool.query<{ state: string }>(`
        SELECT state FROM canopy_delivery_messages WHERE id = ANY($1::uuid[]) ORDER BY channel
      `, [[result.mailId, result.smsId]])
      return rows.rows.length === 2 && rows.rows.every((row) => row.state === 'accepted')
    })
    const deliveries = await pool.query<{ channel: string; state: string; context: { actor: { kind: string }; correlationId: string } }>(`
      SELECT channel, state, context FROM canopy_delivery_messages WHERE id = ANY($1::uuid[]) ORDER BY channel
    `, [[result.mailId, result.smsId]])
    expect(deliveries.rows).toEqual([
      expect.objectContaining({ channel: 'mail', state: 'accepted', context: expect.objectContaining({ actor: expect.objectContaining({ kind: 'system' }) }) }),
      expect.objectContaining({ channel: 'sms', state: 'accepted', context: expect.objectContaining({ actor: expect.objectContaining({ kind: 'system' }) }) }),
    ])
  })

  it('rolls back staged communications and queue handoff with a failed action', async () => {
    const runtime = await bootPersistenceRuntime()
    await expect(runAction(runtime, QueueNotifications, { failAfterQueue: true }))
      .rejects.toThrow('failed after queuing communications')
    expect((await pool.query('SELECT 1 FROM canopy_delivery_messages')).rowCount).toBe(0)
    expect((await pool.query(`SELECT 1 FROM canopy_outbox_messages WHERE message_type = 'canopy.queue'`)).rowCount).toBe(0)
  })

  it('verifies, normalizes, and deduplicates provider delivery webhooks', async () => {
    const runtime = await bootPersistenceRuntime()
    const queued = await runAction(runtime, QueueNotifications, undefined)
    await waitFor(async () => (await pool.query(`SELECT 1 FROM canopy_delivery_messages WHERE id = $1 AND state = 'accepted'`, [queued.mailId])).rowCount === 1)
    const http = new HonoHttpEngine(runtime)

    const timestamp = String(Math.floor(Date.now() / 1_000))
    const mailBody = JSON.stringify([{
      event: 'delivered',
      sg_event_id: 'sendgrid-event-1',
      sg_message_id: 'sendgrid-message-1',
      canopy_message_id: queued.mailId,
    }])
    const mailSignature = sign('sha256', Buffer.from(timestamp + mailBody), sendGridPrivateKey).toString('base64')
    const sendGridResponse = await http.fetch(new Request('http://canopy.test/webhooks/sendgrid', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-twilio-email-event-webhook-timestamp': timestamp,
        'x-twilio-email-event-webhook-signature': mailSignature,
      },
      body: mailBody,
    }))
    expect(sendGridResponse.status).toBe(204)

    const twilioUrl = `http://canopy.test/webhooks/twilio/sms?canopy_message_id=${queued.smsId}`
    const form = { MessageSid: 'SM-delivery-1', MessageStatus: 'delivered' }
    const formBody = new URLSearchParams(form).toString()
    const twilioSignature = createHmac('sha1', twilioAuthToken)
      .update(twilioUrl + Object.keys(form).sort().map((key) => key + form[key as keyof typeof form]).join(''))
      .digest('base64')
    const twilioResponse = await http.fetch(new Request(twilioUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': twilioSignature },
      body: formBody,
    }))
    expect(twilioResponse.status).toBe(204)

    const duplicate = await http.fetch(new Request('http://canopy.test/webhooks/sendgrid', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-twilio-email-event-webhook-timestamp': timestamp,
        'x-twilio-email-event-webhook-signature': mailSignature,
      },
      body: mailBody,
    }))
    expect(duplicate.status).toBe(204)
    const rows = await pool.query<{ id: string; state: string; provider_message_id: string }>(`
      SELECT id, state, provider_message_id FROM canopy_delivery_messages
      WHERE id = ANY($1::uuid[]) ORDER BY channel
    `, [[queued.mailId, queued.smsId]])
    expect(rows.rows).toEqual([
      { id: queued.mailId, state: 'delivered', provider_message_id: 'sendgrid-message-1' },
      { id: queued.smsId, state: 'delivered', provider_message_id: 'SM-delivery-1' },
    ])
    expect((await pool.query(`SELECT 1 FROM canopy_delivery_events WHERE event_id = 'sendgrid-event-1'`)).rowCount).toBe(1)

    const rejected = await http.fetch(new Request('http://canopy.test/webhooks/sendgrid', {
      method: 'POST',
      headers: {
        'x-twilio-email-event-webhook-timestamp': timestamp,
        'x-twilio-email-event-webhook-signature': 'invalid',
      },
      body: mailBody,
    }))
    expect(rejected.status).toBe(403)
  })

  it('inspects and safely redrives failed communications through Arbor', async () => {
    const runtime = await bootPersistenceRuntime()
    const queued = await runAction(runtime, QueueNotifications, undefined)
    await waitFor(async () => (await pool.query(`SELECT 1 FROM canopy_delivery_messages WHERE id = $1 AND state = 'accepted'`, [queued.mailId])).rowCount === 1)
    await pool.query(`UPDATE canopy_delivery_messages SET state = 'undelivered', failure_kind = 'transient', failure_code = 'test' WHERE id = $1`, [queued.mailId])
    const output: string[] = []
    const errors: string[] = []
    expect(await runArbor(['delivery:list', `--database=${connectionString}`], workspace, {
      out: (message) => output.push(message),
      error: (message) => errors.push(message),
    })).toBe(0)
    expect(output.some((line) => line.includes(queued.mailId) && line.includes('undelivered'))).toBe(true)
    expect(await runArbor(['delivery:retry', queued.mailId, `--database=${connectionString}`], workspace, {
      out: (message) => output.push(message),
      error: (message) => errors.push(message),
    })).toBe(0)
    await waitFor(async () => (await pool.query(`SELECT 1 FROM canopy_delivery_messages WHERE id = $1 AND state = 'accepted'`, [queued.mailId])).rowCount === 1)
    expect(errors).toEqual([])
    expect(await runArbor(['delivery:retry', queued.mailId, `--database=${connectionString}`], workspace, {
      out: () => undefined,
      error: (message) => errors.push(message),
    })).toBe(1)
    expect(errors.at(-1)).toContain('only failed or undelivered deliveries may be retried')
  })

  it('applies ordered framework and application migrations with status and drift protection', async () => {
    await pool.query('DROP TABLE IF EXISTS canopy_migrations')
    const root = await temporaryDirectory()
    await mkdir(path.join(root, 'migrations'))
    const migration = path.join(root, 'migrations/20260710_create_arbor_proof.sql')
    await writeFile(migration, 'CREATE TABLE arbor_migration_proof (id text PRIMARY KEY);\n')
    const output: string[] = []
    const errors: string[] = []
    const io = { out: (message: string) => output.push(message), error: (message: string) => errors.push(message) }
    expect(await runArbor(['migrate', `--database=${connectionString}`], root, io)).toBe(0)
    expect(output.some((line) => line.includes('application/20260710_create_arbor_proof.sql'))).toBe(true)
    output.length = 0
    expect(await runArbor(['migrate:status', `--database=${connectionString}`], root, io)).toBe(0)
    expect(output.some((line) => line.includes('applied') && line.includes('application/20260710_create_arbor_proof.sql'))).toBe(true)
    await writeFile(migration, 'CREATE TABLE arbor_migration_proof (id uuid PRIMARY KEY);\n')
    output.length = 0
    expect(await runArbor(['migrate:status', `--database=${connectionString}`], root, io)).toBe(0)
    expect(output.some((line) => line.includes('drifted') && line.includes('application/20260710_create_arbor_proof.sql'))).toBe(true)
    expect(await runArbor(['migrate', `--database=${connectionString}`], root, io)).toBe(1)
    expect(errors.at(-1)).toContain('has changed; create a new migration instead')
  })

  it('exposes model and auth storage ownership to Arbor and Cultivate', async () => {
    const output: string[] = []
    const errors: string[] = []
    const io = { out: (message: string) => output.push(message), error: (message: string) => errors.push(message) }

    expect(await runArbor(['model:list'], persistenceApplication, io)).toBe(0)
    expect(output).toEqual(expect.arrayContaining([
      expect.stringContaining('model:counters/counter canopy canopy_entity_states'),
      expect.stringContaining('model:counters/legacy-customer external legacy_customers key=customer_id version=lock_version'),
      expect.stringContaining('model:counters/legacy-note external legacy_notes key=id version=xmin'),
    ]))
    const cultivate = JSON.parse(await readFile(path.join(persistenceApplication, '.canopy/cultivate.json'), 'utf8')) as {
      roles: { models: Array<{ id: string; storage: unknown }> }
      arbor: { inspect: string[] }
    }
    expect(cultivate.roles.models.find((model) => model.id === 'model:counters/legacy-customer')?.storage)
      .toEqual(expect.objectContaining({ kind: 'table', table: 'legacy_customers', primaryKey: 'customer_id' }))
    expect(cultivate.arbor.inspect).toEqual(expect.arrayContaining(['model:list', 'auth:storage']))

    output.length = 0
    expect(await runArbor(['auth:storage', `--database=${connectionString}`], persistenceApplication, io)).toBe(0)
    expect(output).toEqual(expect.arrayContaining([
      'authentication canopy-owned',
      expect.stringContaining('identities'),
      expect.stringContaining('canopy_auth_identities'),
    ]))
    expect(errors).toEqual([])
  })

  it('runs HTTP, scheduler, and worker as independent roles from one manifest', async () => {
    const artifactsDirectory = await temporaryDirectory()
    await compilePersistenceApplication(artifactsDirectory)
    const environment = {
      DATABASE_CONNECTION_STRING: connectionString,
      COMMUNICATIONS_SEND_GRID_WEBHOOK_PUBLIC_KEY: sendGridPublicKey,
      COMMUNICATIONS_TWILIO_AUTH_TOKEN: twilioAuthToken,
    }
    const producer = await Canopy.boot(Application, {
      artifactsDirectory,
      dotenvPath: false,
      environment,
      roles: { worker: false, scheduler: false },
    })
    runtimes.push(producer)
    const jobId = await runAction(producer, DispatchProcessCounter, { key: 'topology', failUntilAttempt: 0 })
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(await inspectQueueJob(connectionString, jobId)).toBeUndefined()
    expect((await pool.query(`SELECT 1 FROM canopy_outbox_messages WHERE payload->>'id' = $1 AND status = 'pending'`, [jobId])).rowCount).toBe(1)

    const scheduler = await Canopy.boot(Application, {
      artifactsDirectory,
      dotenvPath: false,
      environment,
      roles: { worker: false, scheduler: true },
    })
    runtimes.push(scheduler)
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(await inspectQueueJob(connectionString, jobId)).toBeUndefined()

    const worker = await Canopy.boot(Application, {
      artifactsDirectory,
      dotenvPath: false,
      environment,
      roles: { worker: true, scheduler: false },
    })
    runtimes.push(worker)
    await waitFor(async () => (await inspectQueueJob(connectionString, jobId))?.state === 'completed')
    expect(recordedJobAttempts.some((attempt) => attempt.jobId === jobId)).toBe(true)
  })

  it('executes declared console commands in an admitted actor-aware scope', async () => {
    const runtime = await bootPersistenceRuntime()
    await runtime.admit({
      actor: { kind: 'system', id: 'canopy:arbor' },
      authentication: { state: 'authenticated', identityId: 'canopy:arbor', method: 'console' },
      transport: { kind: 'console', name: 'canopy:describe' },
    }, () => runtime.dispatchCommand('canopy:describe', ['--verbose']))
    expect(commandLog).toEqual([{ arguments: ['--verbose'], actor: 'system' }])
  })

  it('emits structured telemetry and propagates W3C trace context through HTTP', async () => {
    const runtime = await bootPersistenceRuntime()
    const http = new HonoHttpEngine(runtime)
    const traceId = '0123456789abcdef0123456789abcdef'
    const response = await http.fetch(new Request('http://canopy.test/', {
      headers: { traceparent: `00-${traceId}-0123456789abcdef-01` },
    }))
    expect(response.status).toBe(200)
    expect(response.headers.get('traceparent')).toMatch(new RegExp(`^00-${traceId}-[0-9a-f]{16}-01$`))
    expect(telemetryRecords).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'log', event: 'execution.started' }),
      expect.objectContaining({ kind: 'log', event: 'execution.completed' }),
      expect.objectContaining({ kind: 'metric', name: 'canopy.execution.admitted', value: 1 }),
      expect.objectContaining({ kind: 'metric', name: 'canopy.execution.duration' }),
      expect.objectContaining({ kind: 'span', traceId, status: 'ok' }),
    ]))
    expect(JSON.stringify(telemetryRecords)).not.toContain('test-twilio-auth-token')

    const invalid = await http.fetch(new Request('http://canopy.test/', { headers: { traceparent: 'invalid' } }))
    expect(invalid.status).toBe(400)
    expect(await responseFailure(invalid)).toEqual(expect.objectContaining({ code: 'invalid_traceparent' }))
  })

  it('runs model observers in Eloquent-style create and update order', async () => {
    const runtime = await bootPersistenceRuntime()
    await runtime.admit({
      actor: { kind: 'user', id: 'observer-user' },
      correlationId: 'observer-create',
      transport: { kind: 'test' },
    }, () => runtime.actions.execute(CreateCounter, { id: 'observed', value: 2 }))
    expect(observerLog.map((entry) => entry.phase)).toEqual([
      'saving', 'creating', 'created', 'saved', 'committed',
    ])
    expect(observerLog.at(-1)).toEqual(expect.objectContaining({
      correlationId: 'observer-create',
      version: 1,
    }))

    resetObserverLog()
    await runtime.admit({
      actor: { kind: 'user', id: 'observer-user' },
      correlationId: 'observer-update',
      transport: { kind: 'test' },
    }, () => runtime.actions.execute(RenameCounter, { id: 'observed', label: 'renamed' }))
    expect(observerLog.map((entry) => entry.phase)).toEqual([
      'retrieved', 'saving', 'updating', 'updated', 'saved', 'committed',
    ])
    expect(observerLog.at(-1)).toEqual(expect.objectContaining({
      correlationId: 'observer-update',
      version: 2,
    }))
  })

  it('never runs committed observers when the surrounding action rolls back', async () => {
    const runtime = await bootPersistenceRuntime()
    await expect(runAction(runtime, SaveCounter, {
      id: 'observer-rollback',
      amount: 1,
      failAfterWrites: true,
    })).rejects.toThrow('failed after persistence writes')
    expect(observerLog.map((entry) => entry.phase)).toEqual([
      'saving', 'creating', 'created', 'saved',
    ])
    expect(await durableRowCounts()).toEqual({ entities: 0, journal: 0, outbox: 0 })
  })

  it('does not roll back an already-handled signal when its action later fails', async () => {
    const runtime = await bootPersistenceRuntime()
    await expect(runAction(runtime, DispatchCounterSignal, {
      counterId: 'counter-rollback',
      failAfterDispatch: true,
    })).rejects.toThrow('failed after signal dispatch')
    expect(recordedEvents).toEqual([
      expect.objectContaining({ event: 'counter-touched:counter-rollback', phase: 'signal' }),
    ])
  })

  it('rejects signal dispatch outside a Canopy execution', () => {
    expect(() => CounterTouched.dispatch({ counterId: 'outside' })).toThrow(SignalDispatchError)
  })

  it('hands committed jobs through the outbox and retries with stable job identity', async () => {
    const runtime = await bootPersistenceRuntime()
    const jobId = await runtime.admit({
      actor: { kind: 'service', id: 'queue-producer' },
      correlationId: 'queue-retry-correlation',
      transport: { kind: 'test' },
    }, () => runtime.actions.execute(DispatchProcessCounter, {
      key: 'retry-once',
      failUntilAttempt: 1,
      counterId: 'job-counter',
    }))

    await waitFor(async () => (await inspectQueueJob(connectionString, jobId))?.state === 'completed')
    expect(recordedJobAttempts).toHaveLength(2)
    expect(recordedJobAttempts.map((attempt) => attempt.jobId)).toEqual([jobId, jobId])
    expect(recordedJobAttempts.map((attempt) => attempt.attempt)).toEqual([1, 2])
    expect(new Set(recordedJobAttempts.map((attempt) => attempt.executionId)).size).toBe(2)
    for (const attempt of recordedJobAttempts) {
      expect(attempt).toEqual(expect.objectContaining({
        correlationId: 'queue-retry-correlation',
        causationId: jobId,
        actor: 'service',
      }))
    }
    expect(await inspectQueueJob(connectionString, jobId)).toEqual(expect.objectContaining({
      id: jobId,
      state: 'completed',
      retryCount: 1,
      retryLimit: 2,
    }))
    const jobCounter = await pool.query<{ state: { value: number }; version: number }>(`
      SELECT state, version
      FROM canopy_entity_states
      WHERE entity_id = 'job-counter'
    `)
    expect(jobCounter.rows).toEqual([{ state: { id: 'job-counter', value: 1 }, version: 1 }])
    const outbox = await pool.query<{ status: string; payload: { id: string } }>(`
      SELECT status, payload
      FROM canopy_outbox_messages
      WHERE message_type = 'canopy.queue'
    `)
    expect(outbox.rows).toEqual([{ status: 'dispatched', payload: expect.objectContaining({ id: jobId }) }])
  })

  it('retains terminal failures and rolls back jobs dispatched by failed actions', async () => {
    const runtime = await bootPersistenceRuntime()
    const failedJobId = await runAction(runtime, DispatchProcessCounter, {
      key: 'terminal',
      failUntilAttempt: 99,
    })
    await waitFor(async () => (await inspectQueueJob(connectionString, failedJobId))?.state === 'failed')
    expect(recordedJobAttempts.map((attempt) => attempt.attempt)).toEqual([1, 2, 3])
    expect(await inspectQueueJob(connectionString, failedJobId)).toEqual(expect.objectContaining({
      state: 'failed',
      retryCount: 2,
      retryLimit: 2,
    }))

    resetRecordedJobAttempts()
    await expect(runAction(runtime, DispatchProcessCounter, {
      key: 'rolled-back',
      failAfterDispatch: true,
    })).rejects.toThrow('Counter job dispatch rolled back.')
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(recordedJobAttempts).toEqual([])
    const rolledBackOutbox = await pool.query<{ count: string }>(`
      SELECT count(*)
      FROM canopy_outbox_messages
      WHERE message_type = 'canopy.queue'
        AND payload->>'targetId' = 'job:counters/process-counter'
        AND payload->'payload'->>'key' = 'rolled-back'
    `)
    expect(Number(rolledBackOutbox.rows[0]!.count)).toBe(0)
  })

  it('lists, retries, and cancels durable jobs through Arbor operator commands', async () => {
    const runtime = await bootPersistenceRuntime()
    const jobId = await runAction(runtime, DispatchProcessCounter, { key: 'operator', failUntilAttempt: 99 })
    await waitFor(async () => (await inspectQueueJob(connectionString, jobId))?.state === 'failed')
    await runtime.shutdown()
    const output: string[] = []
    const errors: string[] = []
    const io = { out: (message: string) => output.push(message), error: (message: string) => errors.push(message) }
    expect(await runArbor(['queue:failed', `--database=${connectionString}`], workspace, io)).toBe(0)
    expect(output.some((line) => line.includes(jobId) && line.includes('failed'))).toBe(true)
    expect(await runArbor(['queue:retry', jobId, `--database=${connectionString}`], workspace, io)).toBe(0)
    expect((await inspectQueueJob(connectionString, jobId))?.state).toMatch(/created|retry/)
    expect(await runArbor(['queue:cancel', jobId, `--database=${connectionString}`], workspace, io)).toBe(0)
    expect((await inspectQueueJob(connectionString, jobId))?.state).toBe('cancelled')
    expect(errors).toEqual([])
  })

  it('deduplicates one declared job by a stable Canopy idempotency key', async () => {
    const runtime = await bootPersistenceRuntime()
    const [first, second] = await Promise.all([
      runAction(runtime, DispatchProcessCounter, {
        key: 'idempotent',
        idempotencyKey: 'counter:idempotent',
      }),
      runAction(runtime, DispatchProcessCounter, {
        key: 'idempotent',
        idempotencyKey: 'counter:idempotent',
      }),
    ])
    expect(second).toBe(first)
    await waitFor(async () => (await inspectQueueJob(connectionString, first))?.state === 'completed')
    expect(recordedJobAttempts).toEqual([
      expect.objectContaining({ jobId: first, key: 'idempotent', attempt: 1 }),
    ])
    const outbox = await pool.query<{ count: string; dispatched: string }>(`
      SELECT
        count(*) AS count,
        count(*) FILTER (WHERE status = 'dispatched') AS dispatched
      FROM canopy_outbox_messages
      WHERE message_type = 'canopy.queue'
    `)
    expect(outbox.rows[0]).toEqual({ count: '2', dispatched: '2' })
  })

  it('delivers queued listeners with preserved context in a fresh execution', async () => {
    const runtime = await bootPersistenceRuntime()
    await runtime.admit({
      actor: { kind: 'user', id: 'notification-user' },
      correlationId: 'queued-listener-correlation',
      transport: { kind: 'test' },
    }, () => runtime.actions.execute(RequestCounterNotification, 'queued-counter'))

    await waitFor(() => recordedEvents.some((event) => event.phase === 'queued'))
    const queued = recordedEvents.find((event) => event.phase === 'queued')!
    expect(queued).toEqual(expect.objectContaining({
      event: 'counter-notification-requested',
      phase: 'queued',
      correlationId: 'queued-listener-correlation',
      actor: 'user',
      attempt: 1,
    }))
    expect(queued.jobId).toBeDefined()
    expect(queued.executionId).toBeDefined()
    expect(await inspectQueueJob(connectionString, queued.jobId!)).toEqual(expect.objectContaining({
      state: 'completed',
      retryCount: 0,
    }))
  })

  it('honors delays and drains an active worker before runtime shutdown', async () => {
    const runtime = await bootPersistenceRuntime()
    const delayedId = await runAction(runtime, DispatchProcessCounter, {
      key: 'delayed',
      delaySeconds: 0.5,
    })
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(recordedJobAttempts).toEqual([])
    await waitFor(async () => (await inspectQueueJob(connectionString, delayedId))?.state === 'completed')

    resetRecordedJobAttempts()
    const drainingId = await runAction(runtime, DispatchProcessCounter, {
      key: 'draining',
      holdMilliseconds: 250,
    })
    await waitFor(() => recordedJobAttempts.some((attempt) => attempt.key === 'draining'))
    const shutdown = runtime.shutdown()
    expect(runtime.state).toBe('draining')
    await shutdown
    expect(runtime.state).toBe('stopped')
    expect(await inspectQueueJob(connectionString, drainingId)).toEqual(expect.objectContaining({
      state: 'completed',
    }))
  })

  it('reconciles schedules and fires interval work as a causal system job', async () => {
    await bootPersistenceRuntime()
    const schedules = await pool.query<{
      key: string
      cron: string
      timezone: string
    }>(`
      SELECT key, cron, timezone
      FROM pgboss.schedule
      WHERE name = 'canopy-schedules-serial'
    `)
    expect(schedules.rows).toEqual([
      expect.objectContaining({
        key: 'schedule/system/daily-health-check',
        cron: '0 6 * * *',
        timezone: 'America/Chicago',
      }),
    ])

    const interval = await pool.query<{ id: string }>(`
      UPDATE pgboss.job
      SET start_after = now()
      WHERE name = 'canopy-schedules-serial'
        AND data ->> 'id' = 'schedule:counters/process-counters'
      RETURNING id
    `)
    expect(interval.rowCount).toBe(1)
    await waitFor(() => recordedJobAttempts.some(
      (attempt) => attempt.key === 'scheduled-counter-sweep',
    ))
    expect(recordedJobAttempts.find(
      (attempt) => attempt.key === 'scheduled-counter-sweep',
    )).toEqual(expect.objectContaining({
      actor: 'system',
      causationId: 'schedule:counters/process-counters',
      attempt: 1,
    }))
  })

  it('inspects journal/outbox/cache and controls schedules through Arbor', async () => {
    const runtime = await bootPersistenceRuntime()
    await runAction(runtime, SaveCounter, { id: 'operator-state', amount: 1 })
    await runAction(runtime, ExerciseCache, 'operator-cache')
    const output: string[] = []
    const errors: string[] = []
    const io = { out: (message: string) => output.push(message), error: (message: string) => errors.push(message) }
    for (const command of ['journal:list', 'outbox:list', 'cache:list'] as const) {
      expect(await runArbor([command, `--database=${connectionString}`], workspace, io)).toBe(0)
    }
    expect(output.some((line) => line.includes('counter.incremented'))).toBe(true)
    expect(output.some((line) => line.includes('counter.changed'))).toBe(true)
    expect(output.some((line) => line.includes('operator-cache:counter'))).toBe(true)
    expect(await runArbor(['cache:forget', 'operator-cache:counter', `--database=${connectionString}`], workspace, io)).toBe(0)
    expect((await pool.query(`SELECT 1 FROM canopy_cache_entries WHERE key = 'operator-cache:counter'`)).rowCount).toBe(0)

    output.length = 0
    expect(await runArbor(['schedule:status', `--database=${connectionString}`], persistenceApplication, io)).toBe(0)
    expect(output.some((line) => line.includes('schedule:counters/process-counters'))).toBe(true)
    expect(await runArbor(['schedule:disable', 'process-counters', `--database=${connectionString}`], persistenceApplication, io)).toBe(0)
    expect((await pool.query<{ enabled: boolean }>(`SELECT enabled FROM canopy_schedule_controls WHERE schedule_id = 'schedule:counters/process-counters'`)).rows[0]?.enabled).toBe(false)
    expect(await runArbor(['schedule:enable', 'process-counters', `--database=${connectionString}`], persistenceApplication, io)).toBe(0)
    resetRecordedJobAttempts()
    expect(await runArbor(['schedule:run', 'process-counters', `--database=${connectionString}`], persistenceApplication, io)).toBe(0)
    await waitFor(() => Promise.resolve(recordedJobAttempts.some((attempt) => attempt.key === 'scheduled-counter-sweep')))
    expect(errors).toEqual([])
  })

  it('proves the complete actor-aware MVP reference flow through one identity', async () => {
    const runtime = await bootPersistenceRuntime()
    const http = new HonoHttpEngine(runtime)
    const email = 'mvp-flow@example.com'

    const registration = await http.fetch(jsonRequest('http://canopy.test/auth/register', {
      email,
      password: 'complete reference flow password',
    }))
    expect(registration.status).toBe(201)
    const identityId = (await responseData<{ identity: { id: string } }>(registration)).identity.id
    await waitFor(async () => (await pool.query(`SELECT 1 FROM canopy_delivery_messages WHERE payload->>'subject' = 'Verify your email'`)).rowCount === 1)
    const verification = await pool.query<{ text: string }>(`
      SELECT payload->>'text' AS text FROM canopy_delivery_messages
      WHERE payload->>'subject' = 'Verify your email' ORDER BY created_at DESC LIMIT 1
    `)
    const verificationToken = verification.rows[0]!.text.split(': ')[1]!
    expect((await http.fetch(jsonRequest('http://canopy.test/auth/email/verify', { token: verificationToken }))).status).toBe(200)

    const login = await http.fetch(jsonRequest('http://canopy.test/auth/login', {
      email,
      password: 'complete reference flow password',
    }))
    const cookie = login.headers.get('set-cookie')!.split(';', 1)[0]!
    const tokenResponse = await http.fetch(new Request('http://canopy.test/auth/tokens', {
      method: 'POST',
      headers: { cookie, origin: 'http://canopy.test', 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'reference-flow', constraints: ['counters.write', 'counters.update'] }),
    }))
    expect(tokenResponse.status).toBe(201)
    const bearer = (await responseData<{ token: string }>(tokenResponse)).token

    const anonymous = await http.fetch(jsonRequest('http://canopy.test/secure/counters/reference-flow/increment', { amount: 2 }))
    expect(anonymous.status).toBe(401)
    const incremented = await http.fetch(new Request('http://canopy.test/secure/counters/reference-flow/increment', {
      method: 'POST',
      headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
      body: JSON.stringify({ amount: 2 }),
    }))
    expect(incremented.status).toBe(200)
    const result = await responseData<{ id: string; value: number; version: number; jobId: string }>(incremented)
    expect(result).toEqual(expect.objectContaining({ id: 'reference-flow', value: 2, version: 1 }))

    await waitFor(async () => {
      const entity = await pool.query<{ state: { value: number } }>(`
        SELECT state FROM canopy_entity_states WHERE entity_type = 'model:counters/counter' AND entity_id = 'reference-flow'
      `)
      return entity.rows[0]?.state.value === 3
    })
    await waitFor(async () => ((await pool.query(`SELECT 1 FROM canopy_delivery_messages WHERE state = 'accepted'`)).rowCount ?? 0) >= 3)
    expect(recordedEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: 'counter-incremented', phase: 'local', actor: 'user' }),
      expect.objectContaining({ event: 'counter-saved', phase: 'after-commit', actor: 'user' }),
      expect.objectContaining({ event: 'counter-touched:reference-flow', phase: 'signal', actor: 'user' }),
      expect.objectContaining({ event: 'counter-notification-requested', phase: 'queued', actor: 'user' }),
    ]))
    expect(observerLog.some((entry) => entry.phase === 'committed' && entry.modelId === 'reference-flow')).toBe(true)
    expect(recordedJobAttempts).toEqual(expect.arrayContaining([
      expect.objectContaining({ jobId: result.jobId, key: 'secure:reference-flow', actor: 'user' }),
    ]))

    const facts = await pool.query(`SELECT 1 FROM canopy_journal_entries WHERE entity_id = 'reference-flow' AND fact_type = 'counter.incremented'`)
    const handoffs = await pool.query(`SELECT 1 FROM canopy_outbox_messages WHERE context->'actor'->>'id' = $1`, [identityId])
    const audit = await pool.query(`SELECT 1 FROM canopy_auth_audit_events WHERE identity_id = $1 AND event_type = 'authorization.decided'`, [identityId])
    expect(facts.rowCount).toBeGreaterThan(0)
    expect(handoffs.rowCount).toBeGreaterThan(0)
    expect(audit.rowCount).toBeGreaterThan(0)
    expect(telemetryRecords).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'metric', name: 'canopy.authorization.decisions' }),
      expect.objectContaining({ kind: 'metric', name: 'canopy.persistence.transaction.total' }),
      expect.objectContaining({ kind: 'metric', name: 'canopy.queue.delivery.total' }),
      expect.objectContaining({ kind: 'span', status: 'ok' }),
    ]))

    resetRecordedJobAttempts()
    expect(await runArbor(['schedule:run', 'process-counters', `--database=${connectionString}`], persistenceApplication, { out: () => undefined, error: () => undefined })).toBe(0)
    await waitFor(() => Promise.resolve(recordedJobAttempts.some((attempt) => attempt.key === 'scheduled-counter-sweep')))
  })

  it('accepts passwords from 8 through 64 characters and rejects either boundary', async () => {
    const runtime = await bootPersistenceRuntime()
    const http = new HonoHttpEngine(runtime)
    const register = (email: string, password: string) => http.fetch(jsonRequest('http://canopy.test/auth/register', { email, password }))

    const tooShort = await register('seven@example.com', '1234567')
    expect(tooShort.status).toBe(422)
    expect(await responseFailure(tooShort)).toEqual(expect.objectContaining({
      code: 'invalid_registration',
      message: 'Passwords must contain between 8 and 64 characters.',
    }))
    expect((await register('eight@example.com', '12345678')).status).toBe(201)
    expect((await register('sixty-four@example.com', 'x'.repeat(64))).status).toBe(201)
    expect((await register('sixty-five@example.com', 'x'.repeat(65))).status).toBe(422)
  })

  it('registers, authenticates, resolves, protects, and revokes first-party browser sessions', async () => {
    const runtime = await bootPersistenceRuntime()
    const http = new HonoHttpEngine(runtime)

    const registered = await http.fetch(jsonRequest('http://canopy.test/auth/register', {
      email: '  Ada@Example.COM ',
      password: 'correct horse battery staple',
    }))
    expect(registered.status).toBe(201)
    const registration = await responseData<{
      identity: { id: string; email: string; emailVerified: boolean }
    }>(registered)
    expect(registration.identity).toEqual(expect.objectContaining({
      email: 'ada@example.com',
      emailVerified: false,
    }))
    expect(recordedEvents.at(-1)).toEqual(expect.objectContaining({
      event: 'user-registered',
      actor: 'anonymous',
    }))

    const storedPassword = await pool.query<{
      version: number
      salt: string
      hash: string
      parameters: { algorithm: string; memory: number; passes: number }
    }>(`
      SELECT version, salt, hash, parameters
      FROM canopy_auth_passwords
      WHERE identity_id = $1
    `, [registration.identity.id])
    expect(storedPassword.rows[0]).toEqual(expect.objectContaining({
      version: 1,
      parameters: expect.objectContaining({
        algorithm: 'argon2id',
        memory: 19456,
        passes: 2,
      }),
    }))
    expect(JSON.stringify(storedPassword.rows[0])).not.toContain('correct horse battery staple')

    const duplicate = await http.fetch(jsonRequest('http://canopy.test/auth/register', {
      email: 'ada@example.com',
      password: 'another valid password',
    }))
    expect(duplicate.status).toBe(422)
    expect(await responseFailure(duplicate)).toEqual({
      ok: false,
      code: 'email_taken',
      message: 'Unable to create an account with the supplied details.',
      data: null,
    })

    const wrongPassword = await http.fetch(jsonRequest('http://canopy.test/auth/login', {
      email: 'ada@example.com',
      password: 'wrong password value',
    }))
    const unknownIdentity = await http.fetch(jsonRequest('http://canopy.test/auth/login', {
      email: 'nobody@example.com',
      password: 'wrong password value',
    }))
    expect(wrongPassword.status).toBe(401)
    expect(unknownIdentity.status).toBe(401)
    expect(await wrongPassword.json()).toEqual(await unknownIdentity.json())

    const loggedIn = await http.fetch(jsonRequest('http://canopy.test/auth/login', {
      email: 'ADA@example.com',
      password: 'correct horse battery staple',
    }))
    expect(loggedIn.status).toBe(200)
    const setCookie = loggedIn.headers.get('set-cookie')
    expect(setCookie).toContain('canopy_session=')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Lax')
    expect(setCookie).toContain('Path=/')
    expect(setCookie).not.toContain('correct horse battery staple')
    const cookie = setCookie!.split(';', 1)[0]!
    const token = cookie.slice(cookie.indexOf('=') + 1)

    const sessionRow = await pool.query<{
      token_digest: string
      revoked_at: Date | null
    }>(`
      SELECT token_digest, revoked_at
      FROM canopy_auth_sessions
      WHERE identity_id = $1
    `, [registration.identity.id])
    expect(sessionRow.rows[0]?.token_digest).not.toBe(token)
    expect(sessionRow.rows[0]?.token_digest).toMatch(/^[a-f0-9]{64}$/)
    expect(sessionRow.rows[0]?.revoked_at).toBeNull()
    expect(recordedEvents.at(-1)).toEqual(expect.objectContaining({
      event: 'user-logged-in',
      actor: 'anonymous',
    }))

    const me = await http.fetch(new Request('http://canopy.test/auth/me', {
      headers: { cookie },
    }))
    expect(me.status).toBe(200)
    expect(await responseData(me)).toEqual(expect.objectContaining({
      identity: expect.objectContaining({
        id: registration.identity.id,
        email: 'ada@example.com',
      }),
      actor: { kind: 'user', id: registration.identity.id },
      authentication: expect.objectContaining({
        method: 'password',
        assurance: 'single-factor',
      }),
    }))

    const rotated = await http.fetch(new Request('http://canopy.test/auth/login', {
      method: 'POST',
      headers: {
        cookie,
        origin: 'http://canopy.test',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        email: 'ada@example.com',
        password: 'correct horse battery staple',
      }),
    }))
    expect(rotated.status).toBe(200)
    const rotatedCookie = rotated.headers.get('set-cookie')!.split(';', 1)[0]!
    expect(rotatedCookie).not.toBe(cookie)
    const replaced = await http.fetch(new Request('http://canopy.test/auth/me', {
      headers: { cookie },
    }))
    expect(replaced.status).toBe(401)

    const rejectedCsrf = await http.fetch(new Request('http://canopy.test/auth/logout', {
      method: 'POST',
      headers: { cookie: rotatedCookie, origin: 'https://attacker.example' },
    }))
    expect(rejectedCsrf.status).toBe(403)
    expect(await responseFailure(rejectedCsrf)).toEqual(expect.objectContaining({ code: 'untrusted_origin' }))

    const loggedOut = await http.fetch(new Request('http://canopy.test/auth/logout', {
      method: 'POST',
      headers: { cookie: rotatedCookie, origin: 'http://canopy.test' },
    }))
    expect(loggedOut.status).toBe(204)
    expect(loggedOut.headers.get('set-cookie')).toContain('Max-Age=0')

    const afterLogout = await http.fetch(new Request('http://canopy.test/auth/me', {
      headers: { cookie: rotatedCookie },
    }))
    expect(afterLogout.status).toBe(401)
    expect(await responseFailure(afterLogout)).toEqual(expect.objectContaining({ code: 'authentication_required' }))

    const audit = await pool.query<{ event_type: string }>(`
      SELECT event_type FROM canopy_auth_audit_events ORDER BY occurred_at, event_type
    `)
    expect(audit.rows.map((row) => row.event_type)).toEqual(expect.arrayContaining([
      'identity.registered',
      'authentication.failed',
      'session.created',
      'session.revoked',
    ]))
  })

  it('verifies email, resets and changes passwords, revokes sessions, and rate limits abuse', async () => {
    const runtime = await bootPersistenceRuntime()
    const http = new HonoHttpEngine(runtime)
    const registered = await http.fetch(jsonRequest('http://canopy.test/auth/register', {
      email: 'security@example.com', password: 'initial secure password',
    }))
    expect(registered.status).toBe(201)
    const identity = (await responseData<{ identity: { id: string } }>(registered)).identity
    await waitFor(async () => (await pool.query(`SELECT 1 FROM canopy_delivery_messages WHERE payload->>'text' LIKE 'Verification token:%'`)).rowCount === 1)
    const verificationMail = await pool.query<{ text: string }>(`SELECT payload->>'text' AS text FROM canopy_delivery_messages WHERE payload->>'text' LIKE 'Verification token:%' ORDER BY created_at DESC LIMIT 1`)
    const verificationToken = verificationMail.rows[0]!.text.split(': ')[1]!
    expect(verificationToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const challenge = await pool.query<{ token_digest: string }>(`SELECT token_digest FROM canopy_auth_challenges WHERE purpose = 'email_verification'`)
    expect(challenge.rows[0]!.token_digest).not.toBe(verificationToken)
    const verified = await http.fetch(jsonRequest('http://canopy.test/auth/email/verify', { token: verificationToken }))
    expect(verified.status).toBe(200)
    expect(await responseData(verified)).toEqual(expect.objectContaining({ identity: expect.objectContaining({ id: identity.id, emailVerified: true }) }))
    expect((await http.fetch(jsonRequest('http://canopy.test/auth/email/verify', { token: verificationToken }))).status).toBe(422)

    const knownReset = await http.fetch(jsonRequest('http://canopy.test/auth/password/forgot', { email: 'security@example.com' }))
    const unknownReset = await http.fetch(jsonRequest('http://canopy.test/auth/password/forgot', { email: 'unknown@example.com' }))
    expect([knownReset.status, unknownReset.status]).toEqual([202, 202])
    expect(await knownReset.text()).toBe(await unknownReset.text())
    await waitFor(async () => (await pool.query(`SELECT 1 FROM canopy_delivery_messages WHERE payload->>'text' LIKE 'Password reset token:%'`)).rowCount === 1)
    const resetMail = await pool.query<{ text: string }>(`SELECT payload->>'text' AS text FROM canopy_delivery_messages WHERE payload->>'text' LIKE 'Password reset token:%' ORDER BY created_at DESC LIMIT 1`)
    const resetToken = resetMail.rows[0]!.text.split(': ')[1]!
    expect((await http.fetch(jsonRequest('http://canopy.test/auth/password/reset', { token: resetToken, password: 'reset secure password' }))).status).toBe(204)
    expect((await http.fetch(jsonRequest('http://canopy.test/auth/login', { email: 'security@example.com', password: 'initial secure password' }))).status).toBe(401)
    const loggedIn = await http.fetch(jsonRequest('http://canopy.test/auth/login', { email: 'security@example.com', password: 'reset secure password' }))
    expect(loggedIn.status).toBe(200)
    const cookie = loggedIn.headers.get('set-cookie')!.split(';', 1)[0]!
    const changed = await http.fetch(new Request('http://canopy.test/auth/password', {
      method: 'POST', headers: { cookie, origin: 'http://canopy.test', 'content-type': 'application/json' },
      body: JSON.stringify({ currentPassword: 'reset secure password', newPassword: 'final secure password' }),
    }))
    expect(changed.status).toBe(204)
    expect(changed.headers.get('set-cookie')).toContain('Max-Age=0')
    expect((await http.fetch(new Request('http://canopy.test/auth/me', { headers: { cookie } }))).status).toBe(401)

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      expect((await http.fetch(jsonRequest('http://canopy.test/auth/login', { email: 'abuse@example.com', password: 'wrong password value' }))).status).toBe(401)
    }
    const limited = await http.fetch(jsonRequest('http://canopy.test/auth/login', { email: 'abuse@example.com', password: 'wrong password value' }))
    expect(limited.status).toBe(429)
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0)
  })

  it('issues, resolves, rotates, and revokes opaque bearer access tokens', async () => {
    const runtime = await bootPersistenceRuntime()
    const http = new HonoHttpEngine(runtime)
    await http.fetch(jsonRequest('http://canopy.test/auth/register', {
      email: 'bearer@example.com',
      password: 'correct horse battery staple',
    }))
    const login = await http.fetch(jsonRequest('http://canopy.test/auth/login', {
      email: 'bearer@example.com',
      password: 'correct horse battery staple',
    }))
    const cookie = login.headers.get('set-cookie')!.split(';', 1)[0]!

    const issued = await http.fetch(new Request('http://canopy.test/auth/tokens', {
      method: 'POST',
      headers: {
        cookie,
        origin: 'http://canopy.test',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'CI',
        constraints: ['accounts.view-self', 'counters.read', 'counters.write'],
      }),
    }))
    expect(issued.status).toBe(201)
    const issuance = await responseData<{
      accessToken: { id: string; displayPrefix: string; constraints: string[] }
      token: string
    }>(issued)
    expect(issuance.token).toMatch(/^canopy_pat_[A-Za-z0-9_-]{16}_[A-Za-z0-9_-]{43}$/)
    expect(issuance.accessToken).toEqual(expect.objectContaining({
      constraints: ['accounts.view-self', 'counters.read', 'counters.write'],
    }))
    const stored = await pool.query<{ token_digest: string }>(`
      SELECT token_digest FROM canopy_auth_access_tokens WHERE id = $1
    `, [issuance.accessToken.id])
    expect(stored.rows[0]?.token_digest).toMatch(/^[a-f0-9]{64}$/)
    expect(stored.rows[0]?.token_digest).not.toContain(issuance.token)

    const bearerMe = await http.fetch(new Request('http://canopy.test/auth/me', {
      headers: { authorization: `Bearer ${issuance.token}` },
    }))
    expect(bearerMe.status).toBe(200)
    expect(await responseData(bearerMe)).toEqual(expect.objectContaining({
      actor: expect.objectContaining({ kind: 'user' }),
      authentication: expect.objectContaining({
        method: 'bearer',
        credentialId: issuance.accessToken.id,
        constraints: ['accounts.view-self', 'counters.read', 'counters.write'],
      }),
    }))

    const ambiguous = await http.fetch(new Request('http://canopy.test/auth/me', {
      headers: { cookie, authorization: `Bearer ${issuance.token}` },
    }))
    expect(ambiguous.status).toBe(401)
    expect(await responseFailure(ambiguous)).toEqual(expect.objectContaining({ code: 'ambiguous_credentials' }))

    const bearerCannotManage = await http.fetch(new Request('http://canopy.test/auth/tokens', {
      headers: { authorization: `Bearer ${issuance.token}` },
    }))
    expect(bearerCannotManage.status).toBe(403)

    const rotated = await http.fetch(new Request(
      `http://canopy.test/auth/tokens/${issuance.accessToken.id}/rotate`,
      { method: 'POST', headers: { cookie, origin: 'http://canopy.test' } },
    ))
    expect(rotated.status).toBe(200)
    const rotation = await responseData<{ accessToken: { id: string }; token: string }>(rotated)
    expect(rotation.accessToken.id).not.toBe(issuance.accessToken.id)
    const oldToken = await http.fetch(new Request('http://canopy.test/auth/me', {
      headers: { authorization: `Bearer ${issuance.token}` },
    }))
    expect(oldToken.status).toBe(401)
    const newToken = await http.fetch(new Request('http://canopy.test/auth/me', {
      headers: { authorization: `Bearer ${rotation.token}` },
    }))
    expect(newToken.status).toBe(200)

    const revoked = await http.fetch(new Request(
      `http://canopy.test/auth/tokens/${rotation.accessToken.id}`,
      { method: 'DELETE', headers: { cookie, origin: 'http://canopy.test' } },
    ))
    expect(revoked.status).toBe(204)
    const afterRevoke = await http.fetch(new Request('http://canopy.test/auth/me', {
      headers: { authorization: `Bearer ${rotation.token}` },
    }))
    expect(afterRevoke.status).toBe(401)
    const audit = await pool.query<{ event_type: string }>(`
      SELECT event_type FROM canopy_auth_audit_events WHERE event_type LIKE 'access_token.%'
    `)
    expect(audit.rows.map((row) => row.event_type)).toEqual(expect.arrayContaining([
      'access_token.issued',
      'access_token.rotated',
      'access_token.revoked',
    ]))
  })

  it('inspects and revokes sessions and bearer tokens through Arbor without credential leakage', async () => {
    const runtime = await bootPersistenceRuntime()
    const http = new HonoHttpEngine(runtime)
    const registration = await http.fetch(jsonRequest('http://canopy.test/auth/register', { email: 'operator-auth@example.com', password: 'operator secure password' }))
    const identityId = (await responseData<{ identity: { id: string } }>(registration)).identity.id
    const login = await http.fetch(jsonRequest('http://canopy.test/auth/login', { email: 'operator-auth@example.com', password: 'operator secure password' }))
    const cookie = login.headers.get('set-cookie')!.split(';', 1)[0]!
    const issued = await http.fetch(new Request('http://canopy.test/auth/tokens', {
      method: 'POST', headers: { cookie, origin: 'http://canopy.test', 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'operator-proof' }),
    }))
    const tokenGrant = await responseData<{ accessToken: { id: string }; token: string }>(issued)
    const sessionId = (await pool.query<{ id: string }>(`SELECT id FROM canopy_auth_sessions WHERE identity_id = $1 AND revoked_at IS NULL`, [identityId])).rows[0]!.id
    const output: string[] = []
    const errors: string[] = []
    const io = { out: (message: string) => output.push(message), error: (message: string) => errors.push(message) }
    for (const command of ['auth:identities', 'auth:sessions', 'auth:tokens'] as const) {
      expect(await runArbor([command, `--identity=${identityId}`, `--database=${connectionString}`], workspace, io)).toBe(0)
    }
    expect(output.some((line) => line.includes('operator-auth@example.com'))).toBe(true)
    expect(output.some((line) => line.includes(sessionId))).toBe(true)
    expect(output.some((line) => line.includes(tokenGrant.accessToken.id))).toBe(true)
    expect(output.join('\n')).not.toContain(tokenGrant.token)
    expect(output.join('\n')).not.toMatch(/[a-f0-9]{64}/)
    expect(await runArbor(['auth:revoke-session', sessionId, `--database=${connectionString}`], workspace, io)).toBe(0)
    expect(await runArbor(['auth:revoke-token', tokenGrant.accessToken.id, `--database=${connectionString}`], workspace, io)).toBe(0)
    expect((await http.fetch(new Request('http://canopy.test/auth/me', { headers: { cookie } }))).status).toBe(401)
    expect((await http.fetch(new Request('http://canopy.test/auth/me', { headers: { authorization: `Bearer ${tokenGrant.token}` } }))).status).toBe(401)
    expect(errors).toEqual([])
  })

  it('applies structured default-deny entry, resource, and credential-constrained authorization', async () => {
    const runtime = await bootPersistenceRuntime()
    const allowed = await runtime.admit({
      actor: { kind: 'user', id: 'owner-1' },
      authentication: { state: 'authenticated', identityId: 'owner-1', method: 'password' },
      transport: { kind: 'test' },
    }, async () => {
      const decision = await runtime.authorization.decide('counters.update', { ownerId: 'owner-1' })
      await runtime.authorization.authorize('counters.update', { ownerId: 'owner-1' })
      return decision
    })
    expect(allowed).toEqual({
      effect: 'allow',
      policy: 'policy:counters/counter',
      code: 'allowed',
    })

    const denied = await runtime.admit({
      actor: { kind: 'user', id: 'owner-1' },
      authentication: { state: 'authenticated', identityId: 'owner-1', method: 'password' },
      transport: { kind: 'test' },
    }, () => runtime.authorization.authorize('counters.update', { ownerId: 'owner-2' }))
      .catch((error: unknown) => error)
    expect(denied).toBeInstanceOf(AuthorizationError)
    expect((denied as AuthorizationError).decision).toEqual({
      effect: 'deny',
      policy: 'policy:counters/counter',
      code: 'counter_owner_required',
    })

    const missing = await runtime.admit({
      actor: { kind: 'user', id: 'owner-1' },
      authentication: { state: 'authenticated', identityId: 'owner-1', method: 'password' },
      transport: { kind: 'test' },
    }, () => runtime.authorization.decide('undeclared.ability'))
    expect(missing).toEqual({
      effect: 'deny',
      policy: 'canopy:default-deny',
      code: 'policy_missing',
    })

    const constrained = await runtime.admit({
      actor: { kind: 'user', id: 'owner-1' },
      authentication: {
        state: 'authenticated',
        identityId: 'owner-1',
        method: 'bearer',
        constraints: ['counters.read'],
      },
      transport: { kind: 'test' },
    }, () => runtime.authorization.decide('counters.update', { ownerId: 'owner-1' }))
    expect(constrained).toEqual({
      effect: 'deny',
      policy: 'canopy:credential-constraints',
      code: 'credential_constraint_denied',
    })
    const audits = await pool.query<{
      metadata: { ability: string; effect: string; policy: string; code: string }
    }>(`
      SELECT metadata
      FROM canopy_auth_audit_events
      WHERE event_type = 'authorization.decided'
      ORDER BY occurred_at
    `)
    expect(audits.rows.map((row) => row.metadata)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        ability: 'counters.update',
        effect: 'allow',
        policy: 'policy:counters/counter',
      }),
      expect.objectContaining({
        ability: 'undeclared.ability',
        effect: 'deny',
        code: 'policy_missing',
      }),
      expect.objectContaining({
        ability: 'counters.update',
        effect: 'deny',
        code: 'credential_constraint_denied',
      }),
    ]))
  })

  it('serves declared routes through Hono with validation, errors, and anonymous context', async () => {
    const runtime = await bootPersistenceRuntime()
    const http = new HonoHttpEngine(runtime)

    const home = await http.fetch(new Request('http://canopy.test/'))
    expect(home.status).toBe(200)
    expect(await responseData(home)).toEqual(expect.objectContaining({
      name: 'Canopy',
      status: 'growing',
    }))

    const health = await http.fetch(new Request('http://canopy.test/health'))
    expect(health.status).toBe(200)
    expect(await responseData(health)).toEqual({ status: 'ok' })

    const hello = await http.fetch(new Request(
      'http://canopy.test/hello/Ada?greeting=Welcome',
    ))
    expect(hello.status).toBe(200)
    expect(await responseData(hello)).toEqual({ message: 'Welcome, Ada!' })

    const incremented = await http.fetch(new Request(
      'http://canopy.test/counters/http-counter/increment',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-correlation-id': 'http-correlation',
        },
        body: JSON.stringify({ amount: 3 }),
      },
    ))
    expect(incremented.status).toBe(200)
    expect(incremented.headers.get('x-correlation-id')).toBe('http-correlation')
    expect(await responseData(incremented)).toEqual(expect.objectContaining({
      id: 'http-counter',
      value: 3,
      version: 1,
    }))
    expect(recordedEvents).toEqual([
      expect.objectContaining({
        event: 'counter-incremented',
        phase: 'local',
        correlationId: 'http-correlation',
        actor: 'anonymous',
      }),
      expect.objectContaining({
        event: 'counter-incremented',
        phase: 'after-commit',
        correlationId: 'http-correlation',
        actor: 'anonymous',
      }),
      expect.objectContaining({
        event: 'counter-saved',
        phase: 'after-commit',
        correlationId: 'http-correlation',
        actor: 'anonymous',
      }),
    ])

    const pinged = await http.fetch(new Request('http://canopy.test/ping', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'hello' }),
    }))
    expect(await responseData(pinged)).toEqual({ message: 'hello' })
    expect(recordedEvents.at(-1)).toEqual(expect.objectContaining({
      event: 'http-pinged',
      phase: 'http',
      actor: 'anonymous',
    }))

    const invalid = await http.fetch(new Request(
      'http://canopy.test/counters/http-counter/increment',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ amount: 0 }),
      },
    ))
    expect(invalid.status).toBe(422)
    expect(await responseFailure(invalid)).toEqual(expect.objectContaining({ code: 'validation_failed' }))

    const failed = await http.fetch(new Request(
      'http://canopy.test/counters/rejected-http-event/increment',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ amount: 13 }),
      },
    ))
    expect(failed.status).toBe(500)
    expect(await responseFailure(failed)).toEqual({
      ok: false,
      code: 'internal_error',
      message: 'The application could not complete the request.',
      data: null,
    })
    const rejectedEntity = await pool.query<{ count: string }>(`
      SELECT count(*) FROM canopy_entity_states WHERE entity_id = 'rejected-http-event'
    `)
    expect(Number(rejectedEntity.rows[0]!.count)).toBe(0)

    const malformed = await http.fetch(new Request(
      'http://canopy.test/counters/http-counter/increment',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{',
      },
    ))
    expect(malformed.status).toBe(400)
    expect(await responseFailure(malformed)).toEqual({
      ok: false,
      code: 'invalid_json',
      message: 'The request body must contain valid JSON.',
      data: null,
    })

    const afterCommitFailed = await http.fetch(new Request(
      'http://canopy.test/counters/after-commit-http/increment',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ amount: 7 }),
      },
    ))
    expect(afterCommitFailed.status).toBe(500)
    expect(await responseFailure(afterCommitFailed)).toEqual({
      ok: false,
      code: 'after_commit_failed',
      message: 'The action committed, but after-commit processing did not complete successfully.',
      data: null,
    })
    const committedDespiteListener = await pool.query<{ count: string }>(`
      SELECT count(*) FROM canopy_entity_states WHERE entity_id = 'after-commit-http'
    `)
    expect(Number(committedDespiteListener.rows[0]!.count)).toBe(1)

    const missing = await http.fetch(new Request('http://canopy.test/counters/missing', {
      method: 'DELETE',
    }))
    expect(missing.status).toBe(404)
    expect(await responseFailure(missing)).toEqual(expect.objectContaining({ code: 'model_not_found' }))

    const notFound = await http.fetch(new Request('http://canopy.test/nope'))
    expect(notFound.status).toBe(404)
    expect(await responseFailure(notFound)).toEqual(expect.objectContaining({ code: 'route_not_found' }))
  })

  it('hosts Hono on Node, coordinates shutdown, and rejects later admission', async () => {
    const runtime = await bootPersistenceRuntime()
    const signalListeners = {
      sigint: process.listenerCount('SIGINT'),
      sigterm: process.listenerCount('SIGTERM'),
    }
    const host = await HonoHttpHost.listen(runtime, { port: 0, hostname: '127.0.0.1' })
    hosts.push(host)

    const response = await fetch(new URL('/ping', host.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'hosted' }),
    })
    expect(response.status).toBe(200)
    expect(await responseData(response)).toEqual({ message: 'hosted' })
    expect(host.state).toBe('ready')

    const firstShutdown = host.shutdown()
    expect(host.shutdown()).toBe(firstShutdown)
    await firstShutdown
    expect(host.state).toBe('stopped')
    expect(runtime.state).toBe('stopped')
    expect(process.listenerCount('SIGINT')).toBe(signalListeners.sigint)
    expect(process.listenerCount('SIGTERM')).toBe(signalListeners.sigterm)

    const unavailable = await host.engine.fetch(new Request('http://canopy.test/ping', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'late' }),
    }))
    expect(unavailable.status).toBe(503)
  })

  it('hydrates one identity-mapped model and reports clean original state', async () => {
    const runtime = await bootPersistenceRuntime()
    await runAction(runtime, SaveCounter, { id: 'inspect', amount: 2 })

    const inspected = await runAction(runtime, InspectCounter, 'inspect')
    expect(inspected).toEqual({
      sameInstance: true,
      cleanSave: false,
      exists: true,
      version: 1,
      dirty: false,
      clean: true,
      changed: false,
      original: { id: 'inspect', value: 2 },
      changes: {},
      recentlyCreated: false,
    })
  })

  it('maps Eloquent-style models onto existing tables without losing durability or concurrency', async () => {
    const runtime = await bootPersistenceRuntime()
    await pool.query(`
      INSERT INTO legacy_customers (customer_id, full_name, enabled, lock_version)
      VALUES ('legacy-existing', 'Before', true, 7)
    `)
    const updated = await runAction(runtime, SaveLegacyCustomer, {
      id: 'legacy-existing',
      displayName: 'After',
    })
    expect(updated).toEqual({ id: 'legacy-existing', displayName: 'After', version: 8, created: false })
    const existing = await pool.query<{ full_name: string; enabled: boolean; lock_version: number; updated_at: Date }>(`
      SELECT full_name, enabled, lock_version, updated_at FROM legacy_customers WHERE customer_id = 'legacy-existing'
    `)
    expect(existing.rows[0]).toEqual(expect.objectContaining({ full_name: 'After', enabled: true, lock_version: 8 }))
    expect((await pool.query(`SELECT 1 FROM canopy_entity_states WHERE entity_type = 'model:counters/legacy-customer'`)).rowCount).toBe(0)
    expect((await pool.query(`SELECT 1 FROM canopy_journal_entries WHERE entity_type = 'model:counters/legacy-customer' AND entity_id = 'legacy-existing'`)).rowCount).toBe(1)
    expect((await pool.query(`SELECT 1 FROM canopy_outbox_messages WHERE message_type = 'legacy-customer.changed'`)).rowCount).toBe(1)

    const created = await runAction(runtime, SaveLegacyCustomer, { id: 'legacy-created', displayName: 'Created' })
    expect(created).toEqual({ id: 'legacy-created', displayName: 'Created', version: 1, created: true })
    expect((await pool.query(`SELECT 1 FROM legacy_customers WHERE customer_id = 'legacy-created' AND created_at IS NOT NULL AND updated_at IS NOT NULL`)).rowCount).toBe(1)

    const competing = await Promise.allSettled([
      runAction(runtime, SaveLegacyCustomer, { id: 'legacy-existing', displayName: 'Winner', delayAfterLoad: 30 }),
      runAction(runtime, SaveLegacyCustomer, { id: 'legacy-existing', displayName: 'Loser', delayAfterLoad: 30 }),
    ])
    expect(competing.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(competing.filter((result) => result.status === 'rejected')[0]).toEqual(expect.objectContaining({ reason: expect.any(OptimisticConcurrencyError) }))

    await runAction(runtime, DeleteLegacyCustomer, 'legacy-created')
    expect((await pool.query(`SELECT 1 FROM legacy_customers WHERE customer_id = 'legacy-created'`)).rowCount).toBe(0)

    const noteCreated = await runAction(runtime, SaveLegacyNote, { id: 'simple-table', body: 'First' })
    const noteUpdated = await runAction(runtime, SaveLegacyNote, { id: 'simple-table', body: 'Second' })
    expect(noteCreated.version).toBeGreaterThan(0)
    expect(noteUpdated.version).not.toBe(noteCreated.version)
    expect((await pool.query<{ body: string }>(`SELECT body FROM legacy_notes WHERE id = 'simple-table'`)).rows[0]?.body).toBe('Second')
  })

  it('tracks original, dirty, changed, and clean state across save', async () => {
    const runtime = await bootPersistenceRuntime()
    await runAction(runtime, SaveCounter, { id: 'tracking', amount: 2 })

    const updated = await runAction(runtime, SaveCounter, { id: 'tracking', amount: 3 })
    expect(updated).toEqual({
      id: 'tracking',
      value: 5,
      version: 2,
      originalValue: 2,
      changes: { value: 5 },
      dirtyBeforeSave: true,
      cleanAfterSave: true,
      wasChanged: true,
      exists: true,
      recentlyCreated: false,
    })
  })

  it('tracks added and removed optional attributes without model type ceremony', async () => {
    const runtime = await bootPersistenceRuntime()
    await runAction(runtime, SaveCounter, { id: 'optional', amount: 1 })

    expect(await runAction(runtime, RenameCounter, { id: 'optional', label: 'Primary' })).toEqual({
      label: 'Primary',
      changes: { label: 'Primary' },
    })
    expect(await runAction(runtime, RenameCounter, { id: 'optional' })).toEqual({
      label: undefined,
      changes: { label: undefined },
    })
    const entity = await pool.query<{ state: Record<string, unknown> }>(
      `SELECT state FROM canopy_entity_states WHERE entity_id = 'optional'`,
    )
    expect(entity.rows[0]?.state).toEqual({ id: 'optional', value: 1 })
  })

  it('supports create, refresh, and delete without exposing Unit of Work plumbing', async () => {
    const runtime = await bootPersistenceRuntime()
    const created = await runAction(runtime, CreateCounter, { id: 'lifecycle', value: 4 })
    expect(created).toEqual({
      id: 'lifecycle',
      value: 4,
      version: 1,
      exists: true,
      recentlyCreated: true,
      changes: { id: 'lifecycle', value: 4 },
    })

    const refreshed = await runAction(runtime, RefreshCounter, 'lifecycle')
    expect(refreshed).toEqual({
      value: 4,
      dirtyBefore: true,
      cleanAfter: true,
      original: { id: 'lifecycle', value: 4 },
    })
    expect(await durableRowCounts()).toEqual({ entities: 1, journal: 0, outbox: 0 })

    await runAction(runtime, DeleteCounter, 'lifecycle')
    expect(await durableRowCounts()).toEqual({ entities: 0, journal: 1, outbox: 1 })
  })

  it('fails clearly for missing, detached, and stale models', async () => {
    const runtime = await bootPersistenceRuntime()
    await expect(runAction(runtime, InspectCounter, 'missing'))
      .rejects.toBeInstanceOf(ModelNotFoundError)
    await expect(runAction(runtime, SaveDetachedCounter, 'detached'))
      .rejects.toBeInstanceOf(DetachedModelError)

    await runAction(runtime, CreateCounter, { id: 'captured', value: 1 })
    await runAction(runtime, CaptureCounter, 'captured')
    expect(capturedCounter).toBeDefined()
    expect(() => capturedCounter!.save()).toThrow(StaleModelError)
    expect(() => Counter.find('captured')).toThrow(StaleModelError)
    expect(() => HttpPinged.dispatch({ message: 'outside' })).toThrow(EventDispatchError)
  })

  it('rejects Unit of Work writes from query mode before touching PostgreSQL', async () => {
    const runtime = await bootPersistenceRuntime()
    await expect(runtime.admit({
      actor: { kind: 'system', id: 'query-test' },
      transport: { kind: 'test' },
    }, () => runtime.queries.execute(AttemptCounterWrite, 'query-counter')))
      .rejects.toBeInstanceOf(ReadOnlyExecutionError)
    expect(await durableRowCounts()).toEqual({ entities: 0, journal: 0, outbox: 0 })
  })

  it('turns concurrent version races into one stable optimistic-concurrency failure', async () => {
    const runtime = await bootPersistenceRuntime()
    await runtime.admit({
      actor: { kind: 'system', id: 'seed' },
      transport: { kind: 'test' },
    }, () => runtime.actions.execute(SaveCounter, { id: 'contended', amount: 1 }))
    const attempts = await Promise.allSettled([2, 3].map((amount) => runtime.admit({
      actor: { kind: 'service', id: `writer-${amount}` },
      transport: { kind: 'test' },
    }, () => runtime.actions.execute(SaveCounter, {
      id: 'contended',
      amount,
      delayAfterLoad: 20,
    }))))

    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1)
    const rejected = attempts.find((attempt) => attempt.status === 'rejected')
    expect(rejected).toMatchObject({
      status: 'rejected',
      reason: expect.any(OptimisticConcurrencyError),
    })
    const entity = await pool.query<{ version: number; state: { value: number } }>(
      `SELECT version, state FROM canopy_entity_states WHERE entity_id = 'contended'`,
    )
    expect(entity.rows[0]?.version).toBe(2)
    expect([3, 4]).toContain(entity.rows[0]?.state.value)
    expect(await durableRowCounts()).toEqual({ entities: 1, journal: 2, outbox: 2 })
  })

  it('releases after-commit work only after another connection can see durability', async () => {
    const manager = new PostgresTransactionManager({ connectionString })
    const lifecycle = lifecycleContext()
    await manager.start(lifecycle)
    let visibleAfterCommit = false
    let escaped: UnitOfWork | undefined
    try {
      await manager.transaction(executionContext('after-commit'), async (unitOfWork) => {
        escaped = unitOfWork
        await unitOfWork.saveEntity({
          type: 'counter',
          id: 'after-commit',
          state: { value: 1 },
        })
        unitOfWork.afterCommit(async () => {
          const result = await pool.query<{ count: string }>(`
            SELECT count(*) FROM canopy_entity_states WHERE entity_id = 'after-commit'
          `)
          visibleAfterCommit = Number(result.rows[0]!.count) === 1
        })
        expect(visibleAfterCommit).toBe(false)
      })
      expect(visibleAfterCommit).toBe(true)
      await expect(escaped!.saveEntity({
        type: 'counter',
        id: 'stale-write',
        state: { value: 2 },
      })).rejects.toBeInstanceOf(StaleUnitOfWorkError)
    } finally {
      await manager.dispose(lifecycle)
    }
  })

  it('reports after-commit failure without rolling back durable state', async () => {
    const manager = new PostgresTransactionManager({ connectionString })
    const lifecycle = lifecycleContext()
    await manager.start(lifecycle)
    try {
      await expect(manager.transaction(executionContext('after-commit-failure'), async (unitOfWork) => {
        await unitOfWork.saveEntity({
          type: 'counter',
          id: 'after-commit-failure',
          state: { value: 1 },
        })
        unitOfWork.afterCommit(() => {
          throw new Error('after-commit listener failed')
        })
      })).rejects.toBeInstanceOf(AfterCommitError)

      const durable = await pool.query<{ count: string }>(`
        SELECT count(*) FROM canopy_entity_states WHERE entity_id = 'after-commit-failure'
      `)
      expect(Number(durable.rows[0]!.count)).toBe(1)
    } finally {
      await manager.dispose(lifecycle)
    }
  })

  it('rotates opaque browser sessions with bounded concurrent-request grace', async () => {
    const auth = new PostgresAuth({
      connectionString,
      secureCookies: false,
      trustedOrigins: ['http://canopy.test'],
      sessionRenewalSeconds: 0,
      sessionRotationGraceSeconds: 30,
    })
    await auth.start(lifecycleContext())
    try {
      const email = `rotation-${Date.now()}@example.com`
      await auth.register({ email, password: 'rotation secure password' })
      const grant = await auth.login({ email, password: 'rotation secure password' })
      const oldToken = grant.token.reveal()
      const rotated = await auth.resolveHttp(new Request('http://canopy.test/auth/me', {
        headers: { cookie: `canopy_session=${oldToken}` },
      }))
      expect(rotated.authentication.state).toBe('authenticated')
      const replacementCookie = rotated.responseHeaders?.['set-cookie']
      expect(replacementCookie).toContain('canopy_session=')
      const replacement = replacementCookie!.match(/canopy_session=([^;]+)/)![1]!
      expect(replacement).not.toBe(oldToken)

      const concurrentOld = await auth.resolveHttp(new Request('http://canopy.test/auth/me', {
        headers: { cookie: `canopy_session=${oldToken}` },
      }))
      expect(concurrentOld.authentication.state).toBe('authenticated')
      expect(concurrentOld.responseHeaders).toBeUndefined()
      await pool.query(`UPDATE canopy_auth_sessions SET previous_token_expires_at = now() - interval '1 second' WHERE id = $1`, [grant.session.id])
      expect((await auth.resolveHttp(new Request('http://canopy.test/auth/me', {
        headers: { cookie: `canopy_session=${oldToken}` },
      }))).authentication.state).toBe('anonymous')
      expect((await auth.resolveHttp(new Request('http://canopy.test/auth/me', {
        headers: { cookie: `canopy_session=${replacement}` },
      }))).authentication.state).toBe('authenticated')
    } finally { await auth.dispose(lifecycleContext()) }
  })

  it('maps first-party identities and passwords onto an existing user table', async () => {
    const auth = new PostgresAuth({
      connectionString,
      secureCookies: false,
      trustedOrigins: ['http://canopy.test'],
      identityId: () => 'employee-42',
      tables: {
        identities: {
          table: 'legacy_auth_users',
          id: 'external_id',
          email: 'email_address',
          emailVerifiedAt: 'verified_at',
          createdAt: 'created_on',
          updatedAt: 'updated_on',
        },
        passwords: {
          table: 'legacy_auth_users',
          identityId: 'external_id',
          password: 'password_record',
          updatedAt: 'updated_on',
        },
      },
    })
    expect(auth.storage()).toEqual({
      kind: 'mapped',
      identities: { table: 'legacy_auth_users', ownership: 'external' },
      passwords: { table: 'legacy_auth_users', ownership: 'external' },
      sessions: { table: 'canopy_auth_sessions', ownership: 'canopy' },
      accessTokens: { table: 'canopy_auth_access_tokens', ownership: 'canopy' },
      challenges: { table: 'canopy_auth_challenges', ownership: 'canopy' },
      audit: { table: 'canopy_auth_audit_events', ownership: 'canopy' },
    })
    await auth.start(lifecycleContext())
    try {
      const identity = await auth.register({ email: 'legacy@example.com', password: 'legacy secure password' })
      expect(identity).toEqual(expect.objectContaining({ id: 'employee-42', email: 'legacy@example.com', emailVerified: false }))
      const legacy = await pool.query<{ external_id: string; email_address: string; password_record: string }>(`
        SELECT external_id, email_address, password_record FROM legacy_auth_users WHERE external_id = 'employee-42'
      `)
      expect(legacy.rows[0]).toEqual(expect.objectContaining({ external_id: 'employee-42', email_address: 'legacy@example.com' }))
      expect(legacy.rows[0]!.password_record).toMatch(/^canopy-argon2id:/)
      expect((await pool.query(`SELECT 1 FROM canopy_auth_identities`)).rowCount).toBe(0)
      expect((await pool.query(`SELECT 1 FROM canopy_auth_passwords`)).rowCount).toBe(0)

      const verification = await auth.issueEmailVerification(identity.id)
      expect((await auth.verifyEmail(verification.token.reveal())).emailVerified).toBe(true)
      expect((await pool.query<{ verified_at: Date | null }>(`SELECT verified_at FROM legacy_auth_users WHERE external_id = 'employee-42'`)).rows[0]?.verified_at).toBeInstanceOf(Date)

      const grant = await auth.login({ email: 'legacy@example.com', password: 'legacy secure password' })
      expect(grant.session.identityId).toBe('employee-42')
      expect((await auth.resolveHttp(new Request('http://canopy.test/auth/me', {
        headers: { cookie: `canopy_session=${grant.token.reveal()}` },
      }))).actor).toEqual({ kind: 'user', id: 'employee-42' })

      const access = await auth.issueAccessToken(identity.id, { name: 'legacy-api', constraints: ['profile.view'] })
      expect((await auth.resolveHttp(new Request('http://canopy.test/auth/me', {
        headers: { authorization: `Bearer ${access.token.reveal()}` },
      }))).authentication).toEqual(expect.objectContaining({ identityId: 'employee-42', method: 'bearer' }))

      await auth.changePassword(identity.id, 'legacy secure password', 'replacement secure password')
      await expect(auth.login({ email: 'legacy@example.com', password: 'legacy secure password' })).rejects.toMatchObject({ code: 'invalid_credentials' })
      expect((await auth.login({ email: 'legacy@example.com', password: 'replacement secure password' })).identity.id).toBe('employee-42')
      await auth.recordAuthorization('profile.view', { effect: 'allow', policy: 'legacy', code: 'owner' }, {
        executionId: 'mapped-auth-execution',
        correlationId: 'mapped-auth-correlation',
        actor: { kind: 'user', id: 'employee-42' },
        initiator: { kind: 'user', id: 'employee-42' },
        delegation: [],
        authentication: { state: 'authenticated', identityId: 'employee-42', method: 'bearer' },
        transport: { kind: 'test' },
        trace: {},
        cancellation: new AbortController().signal,
      })
      expect((await pool.query(`SELECT 1 FROM canopy_auth_audit_events WHERE identity_id = 'employee-42'`)).rowCount).toBeGreaterThan(0)
    } finally { await auth.dispose(lifecycleContext()) }
  })

  it('fails readiness when mapped auth columns do not exist', async () => {
    const auth = new PostgresAuth({
      connectionString,
      secureCookies: false,
      trustedOrigins: ['http://canopy.test'],
      tables: {
        identities: {
          table: 'legacy_auth_users',
          id: 'external_id',
          email: 'missing_email_column',
          emailVerifiedAt: 'verified_at',
          createdAt: 'created_on',
          updatedAt: 'updated_on',
        },
        passwords: {
          table: 'legacy_auth_users',
          identityId: 'external_id',
          password: 'password_record',
          updatedAt: 'updated_on',
        },
      },
    })
    await expect(auth.start(lifecycleContext())).rejects.toThrow('missing_email_column')
  })
})

async function bootPersistenceRuntime(): Promise<CanopyRuntime> {
  const artifactsDirectory = await temporaryDirectory()
  await compilePersistenceApplication(artifactsDirectory)
  const runtime = await Canopy.boot(Application, {
    artifactsDirectory,
    dotenvPath: false,
    environment: {
      DATABASE_CONNECTION_STRING: connectionString,
      COMMUNICATIONS_SEND_GRID_WEBHOOK_PUBLIC_KEY: sendGridPublicKey,
      COMMUNICATIONS_TWILIO_AUTH_TOKEN: twilioAuthToken,
    },
  })
  runtimes.push(runtime)
  return runtime
}

class FailingObservationRecorder extends ObservationRecorder {
  start(): void {}
  drain(): void {}
  dispose(): void {}
  record(): void { throw new Error('observation storage unavailable') }
}

function runAction<Input, Output>(
  runtime: CanopyRuntime,
  action: ActionClass<Input, Output>,
  input: Input,
): Promise<Awaited<Output>> {
  executionSequence += 1
  return runtime.admit({
    actor: { kind: 'system', id: `model-test-${executionSequence}` },
    transport: { kind: 'test' },
  }, () => runtime.actions.execute(action, input))
}

async function compilePersistenceApplication(artifactsDirectory: string) {
  return compileApplication({
    tsconfigPath: path.join(persistenceApplication, 'tsconfig.json'),
    applicationFile: path.join(persistenceApplication, 'src/application.ts'),
    sourceRoot: path.join(persistenceApplication, 'src'),
    outputRoot: path.join(persistenceApplication, 'dist'),
    artifactsDirectory,
  })
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'canopy-persistence-'))
  temporaryDirectories.push(directory)
  return directory
}

async function durableRowCounts(): Promise<{
  entities: number
  journal: number
  outbox: number
}> {
  const result = await pool.query<{
    entities: string
    journal: string
    outbox: string
  }>(`
    SELECT
      (SELECT count(*) FROM canopy_entity_states) AS entities,
      (SELECT count(*) FROM canopy_journal_entries) AS journal,
      (SELECT count(*) FROM canopy_outbox_messages) AS outbox
  `)
  const counts = result.rows[0]!
  return {
    entities: Number(counts.entities),
    journal: Number(counts.journal),
    outbox: Number(counts.outbox),
  }
}

function lifecycleContext() {
  return {
    signal: new AbortController().signal,
    deadline: new Date(Date.now() + 10_000),
  }
}

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function responseData<Payload = unknown>(response: Response): Promise<Payload> {
  const envelope = await response.json() as { ok?: unknown; data?: unknown }
  expect(envelope.ok).toBe(true)
  return envelope.data as Payload
}

async function responseFailure(response: Response): Promise<{
  readonly ok: false
  readonly code: string
  readonly message: string
  readonly data: null
  readonly details?: unknown
}> {
  const envelope = await response.json() as {
    ok: false
    code: string
    message: string
    data: null
    details?: unknown
  }
  expect(envelope).toEqual(expect.objectContaining({ ok: false, data: null }))
  return envelope
}

function executionContext(id: string): ExecutionContext {
  const actor = Object.freeze({ kind: 'system' as const, id: 'persistence-test' })
  return Object.freeze({
    executionId: id,
    correlationId: id,
    actor,
    initiator: actor,
    delegation: Object.freeze([]),
    authentication: Object.freeze({ state: 'anonymous' as const }),
    transport: Object.freeze({ kind: 'test' as const }),
    trace: Object.freeze({}),
    cancellation: new AbortController().signal,
  })
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMilliseconds = 8_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMilliseconds
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`Condition was not met within ${timeoutMilliseconds}ms.`)
}
