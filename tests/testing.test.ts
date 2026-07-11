import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { compileApplication } from '@canopy/compiler'
import {
  CanopyTestHarness,
  FakeMailTransport,
  FakeQueueManager,
  FakeSmsTransport,
  MemoryCache,
  MemoryTelemetry,
  MemoryTransactionManager,
} from '@canopy/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { Application } from '../examples/persistence-app/dist/application.js'
import { CreateCounter } from '../examples/persistence-app/dist/counters/actions/create-counter.js'
import { QueueNotifications } from '../examples/persistence-app/dist/counters/actions/queue-notifications.js'
import { SaveCounter } from '../examples/persistence-app/dist/counters/actions/save-counter.js'
import { SaveLegacyCustomer } from '../examples/persistence-app/dist/counters/actions/save-legacy-customer.js'
import { CounterIncremented } from '../examples/persistence-app/dist/counters/events/counter-incremented.js'
import { ProcessCounterJob } from '../examples/persistence-app/dist/counters/jobs/process-counter.job.js'
import { CounterTouched } from '../examples/persistence-app/dist/counters/signals/counter-touched.js'
import { recordedEvents, resetRecordedEvents } from '../examples/persistence-app/dist/support/recorded-events.js'
import { recordedJobAttempts, resetRecordedJobAttempts } from '../examples/persistence-app/dist/support/job-attempts.js'

const workspace = path.resolve(import.meta.dirname, '..')
const applicationRoot = path.join(workspace, 'examples/persistence-app')
let artifacts: string

describe('@canopy/testing', () => {
  beforeAll(async () => {
    artifacts = await mkdtemp(path.join(tmpdir(), 'canopy-testing-'))
    await compileApplication({
      tsconfigPath: path.join(applicationRoot, 'tsconfig.json'),
      applicationFile: path.join(applicationRoot, 'src/application.ts'),
      sourceRoot: path.join(applicationRoot, 'src'),
      outputRoot: path.join(applicationRoot, 'dist'),
      artifactsDirectory: artifacts,
    })
  })

  afterAll(async () => { await rm(artifacts, { recursive: true, force: true }) })

  it('boots the real manifest with visible deterministic provider overrides', async () => {
    const queue = new FakeQueueManager()
    const transactions = new MemoryTransactionManager(queue)
    const mail = new FakeMailTransport()
    const sms = new FakeSmsTransport()
    const telemetry = new MemoryTelemetry()
    const harness = await CanopyTestHarness.boot(Application, {
      artifactsDirectory: artifacts,
      dotenvPath: false,
      environment: { DATABASE_CONNECTION_STRING: 'test-memory-database' },
      authProviderId: 'provider:infrastructure/auth',
      providerOverrides: {
        'provider:infrastructure/transactions': transactions,
        'provider:infrastructure/queues': queue,
        'provider:infrastructure/cache': new MemoryCache(),
        'provider:infrastructure/mail': mail,
        'provider:infrastructure/sms': sms,
        'provider:infrastructure/telemetry': telemetry,
      },
    })
    try {
      harness.actingAsUser('ada')
      expect(await harness.action(CreateCounter, { id: 'memory-counter', value: 4 }))
        .toEqual(expect.objectContaining({ id: 'memory-counter', version: 1 }))
      expect(transactions.state.entities.get('model:counters/counter/memory-counter'))
        .toEqual(expect.objectContaining({ state: { id: 'memory-counter', value: 4 }, version: 1 }))

      const me = await harness.request('http://canopy.test/auth/me')
      expect(me.status).toBe(200)
      expect(await me.json()).toEqual(expect.objectContaining({ actor: { kind: 'user', id: 'ada' } }))

      const ids = await harness.action(QueueNotifications, undefined)
      expect(queue.queued).toHaveLength(2)
      await queue.runNext()
      await queue.runNext()
      expect(mail.sent).toHaveLength(1)
      expect(sms.sent).toHaveLength(1)
      expect(transactions.state.deliveries.get(ids.mailId)?.state).toBe('accepted')
      expect(transactions.state.deliveries.get(ids.smsId)?.state).toBe('accepted')
      expect(telemetry.records.some((record) => record.kind === 'span')).toBe(true)
    } finally { await harness.shutdown() }
  })

  it('preserves rollback and after-commit semantics in memory', async () => {
    const transactions = new MemoryTransactionManager()
    const harness = await CanopyTestHarness.boot(Application, {
      artifactsDirectory: artifacts,
      dotenvPath: false,
      environment: { DATABASE_CONNECTION_STRING: 'test-memory-database' },
      authProviderId: 'provider:infrastructure/auth',
      providerOverrides: {
        'provider:infrastructure/transactions': transactions,
        'provider:infrastructure/queues': new FakeQueueManager(),
        'provider:infrastructure/cache': new MemoryCache(),
        'provider:infrastructure/mail': new FakeMailTransport(),
        'provider:infrastructure/sms': new FakeSmsTransport(),
        'provider:infrastructure/telemetry': new MemoryTelemetry(),
      },
    })
    try {
      harness.actingAsSystem()
      await expect(harness.action(SaveCounter, { id: 'rolled-back', amount: 1, failAfterWrites: true }))
        .rejects.toThrow('failed after persistence writes')
      expect(transactions.state.entities.size).toBe(0)
      expect(transactions.state.journal).toEqual([])
      expect(transactions.state.outbox).toEqual([])
    } finally { await harness.shutdown() }
  })

  it('preserves mapped-model semantics in the first-party memory fake', async () => {
    const transactions = new MemoryTransactionManager()
    const harness = await CanopyTestHarness.boot(Application, {
      artifactsDirectory: artifacts,
      dotenvPath: false,
      environment: { DATABASE_CONNECTION_STRING: 'test-memory-database' },
      authProviderId: 'provider:infrastructure/auth',
      providerOverrides: {
        'provider:infrastructure/transactions': transactions,
        'provider:infrastructure/queues': new FakeQueueManager(),
        'provider:infrastructure/cache': new MemoryCache(),
        'provider:infrastructure/mail': new FakeMailTransport(),
        'provider:infrastructure/sms': new FakeSmsTransport(),
        'provider:infrastructure/telemetry': new MemoryTelemetry(),
      },
    })
    try {
      harness.actingAsSystem()
      expect(await harness.action(SaveLegacyCustomer, { id: 'mapped-memory', displayName: 'Mapped' }))
        .toEqual({ id: 'mapped-memory', displayName: 'Mapped', version: 1, created: true })
      expect(transactions.state.entities.get('model:counters/legacy-customer/mapped-memory'))
        .toEqual(expect.objectContaining({
          state: { id: 'mapped-memory', displayName: 'Mapped', active: true },
          version: 1,
        }))
    } finally { await harness.shutdown() }
  })

  it('drives events, signals, jobs, and schedules through first-party test APIs', async () => {
    resetRecordedEvents()
    resetRecordedJobAttempts()
    const queue = new FakeQueueManager()
    const transactions = new MemoryTransactionManager(queue)
    const harness = await CanopyTestHarness.boot(Application, {
      artifactsDirectory: artifacts,
      dotenvPath: false,
      environment: { DATABASE_CONNECTION_STRING: 'test-memory-database' },
      authProviderId: 'provider:infrastructure/auth',
      providerOverrides: {
        'provider:infrastructure/transactions': transactions,
        'provider:infrastructure/queues': queue,
        'provider:infrastructure/cache': new MemoryCache(),
        'provider:infrastructure/mail': new FakeMailTransport(),
        'provider:infrastructure/sms': new FakeSmsTransport(),
        'provider:infrastructure/telemetry': new MemoryTelemetry(),
      },
    })
    try {
      harness.actingAsSystem()
      await harness.event(CounterIncremented, 'direct-event', 2, 2)
      await harness.signal(CounterTouched, 'direct-signal')
      const jobId = await harness.job(ProcessCounterJob, { key: 'direct-job' })
      expect(queue.hasQueued(ProcessCounterJob)).toBe(true)
      await queue.runNext()
      await queue.runSchedule('schedule:counters/process-counters')
      expect(recordedEvents).toEqual(expect.arrayContaining([
        expect.objectContaining({ event: 'counter-incremented', value: 2 }),
        expect.objectContaining({ event: 'counter-touched:direct-signal', phase: 'signal' }),
      ]))
      expect(recordedJobAttempts).toEqual(expect.arrayContaining([
        expect.objectContaining({ jobId, key: 'direct-job' }),
        expect.objectContaining({ key: 'scheduled-counter-sweep', causationId: 'schedule:counters/process-counters' }),
      ]))
    } finally { await harness.shutdown() }
  })
})
