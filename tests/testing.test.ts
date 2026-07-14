import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { compileApplication } from '@doxajs/compiler'
import {
  DoxaTestHarness,
  FakeMailTransport,
  FakeQueueManager,
  FakeSmsTransport,
  MemoryCache,
  MemoryTelemetry,
  MemoryTransactionManager,
} from '@doxajs/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { Application } from '../examples/persistence-app/dist/application.js'
import { CreateCounter } from '../examples/persistence-app/dist/counters/actions/create-counter.js'
import { AssignCounterTag } from '../examples/persistence-app/dist/counters/actions/assign-counter-tag.js'
import { CreateCounterNote } from '../examples/persistence-app/dist/counters/actions/create-counter-note.js'
import { RenameCounter } from '../examples/persistence-app/dist/counters/actions/rename-counter.js'
import { QueueNotifications } from '../examples/persistence-app/dist/counters/actions/queue-notifications.js'
import { SaveCounter } from '../examples/persistence-app/dist/counters/actions/save-counter.js'
import { SaveLegacyCustomer } from '../examples/persistence-app/dist/counters/actions/save-legacy-customer.js'
import { InspectCounterQueries } from '../examples/persistence-app/dist/counters/queries/inspect-counter-queries.js'
import { CounterIncremented } from '../examples/persistence-app/dist/counters/events/counter-incremented.js'
import { CounterSaved } from '../examples/persistence-app/dist/counters/events/counter-saved.js'
import { CounterCreated } from '../examples/persistence-app/dist/counters/events/counter-created.js'
import { RecordCounterIncremented } from '../examples/persistence-app/dist/counters/listeners/record-counter-incremented.js'
import { ProcessCounterJob } from '../examples/persistence-app/dist/counters/jobs/process-counter.job.js'
import { CounterTouched } from '../examples/persistence-app/dist/counters/signals/counter-touched.js'
import {
  recordedEvents,
  resetRecordedEvents,
} from '../examples/persistence-app/dist/support/recorded-events.js'
import {
  recordedJobAttempts,
  resetRecordedJobAttempts,
} from '../examples/persistence-app/dist/support/job-attempts.js'

const workspace = path.resolve(import.meta.dirname, '..')
const applicationRoot = path.join(workspace, 'examples/persistence-app')
let artifacts: string

describe('@doxajs/testing', () => {
  beforeAll(async () => {
    artifacts = await mkdtemp(path.join(tmpdir(), 'doxa-testing-'))
    await compileApplication({
      tsconfigPath: path.join(applicationRoot, 'tsconfig.json'),
      applicationFile: path.join(applicationRoot, 'src/application.ts'),
      sourceRoot: path.join(applicationRoot, 'src'),
      outputRoot: path.join(applicationRoot, 'dist'),
      artifactsDirectory: artifacts,
    })
  })

  afterAll(async () => {
    await rm(artifacts, { recursive: true, force: true })
  })

  it('boots the real manifest with visible deterministic provider overrides', async () => {
    const queue = new FakeQueueManager()
    const transactions = new MemoryTransactionManager(queue)
    const mail = new FakeMailTransport()
    const sms = new FakeSmsTransport()
    const telemetry = new MemoryTelemetry()
    const harness = await DoxaTestHarness.boot(Application, {
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
      expect(await harness.action(CreateCounter, { id: 'memory-counter', value: 4 })).toEqual(
        expect.objectContaining({ id: 'memory-counter', version: 1 }),
      )
      expect(transactions.state.entities.get('model:counters/counter/memory-counter')).toEqual(
        expect.objectContaining({ state: { id: 'memory-counter', value: 4 }, version: 1 }),
      )

      const me = await harness.request('http://doxa.test/auth/me')
      expect(me.status).toBe(200)
      expect(await me.json()).toEqual(
        expect.objectContaining({
          ok: true,
          data: expect.objectContaining({ actor: { kind: 'user', id: 'ada' } }),
        }),
      )
      const home = await harness.request('http://doxa.test/')
      expect(home.status).toBe(200)
      expect((await harness.request('http://doxa.test/missing')).status).toBe(404)
      expect(harness.logs.records).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            channel: 'home-route',
            message: 'Doxa home visited',
            context: expect.objectContaining({ transport: 'http', actorKind: 'user' }),
          }),
          expect.objectContaining({ channel: 'http', message: 'Execution completed' }),
          expect.objectContaining({
            channel: 'http',
            level: 'warn',
            message: 'GET /missing',
            attributes: { status: 404 },
          }),
        ]),
      )

      const ids = await harness.action(QueueNotifications, undefined)
      expect(queue.queued).toHaveLength(2)
      await queue.runNext()
      await queue.runNext()
      expect(mail.sent).toHaveLength(1)
      expect(sms.sent).toHaveLength(1)
      expect(transactions.state.deliveries.get(ids.mailId)?.state).toBe('accepted')
      expect(transactions.state.deliveries.get(ids.smsId)?.state).toBe('accepted')
      expect(telemetry.records.some((record) => record.kind === 'span')).toBe(true)
      expect(harness.observations?.observations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'action', phase: 'completed' }),
          expect.objectContaining({ kind: 'log', name: 'Doxa home visited' }),
        ]),
      )
    } finally {
      await harness.shutdown()
    }
  })

  it('preserves rollback and after-commit semantics in memory', async () => {
    const transactions = new MemoryTransactionManager()
    const harness = await DoxaTestHarness.boot(Application, {
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
      await expect(
        harness.action(SaveCounter, { id: 'rolled-back', amount: 1, failAfterWrites: true }),
      ).rejects.toThrow('failed after persistence writes')
      expect(transactions.state.entities.size).toBe(0)
      expect(transactions.state.journal).toEqual([])
      expect(transactions.state.outbox).toEqual([])
    } finally {
      await harness.shutdown()
    }
  })

  it('preserves mapped-model semantics in the first-party memory fake', async () => {
    const transactions = new MemoryTransactionManager()
    const harness = await DoxaTestHarness.boot(Application, {
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
      expect(
        await harness.action(SaveLegacyCustomer, { id: 'mapped-memory', displayName: 'Mapped' }),
      ).toEqual({ id: 'mapped-memory', displayName: 'Mapped', version: 1, created: true })
      expect(
        transactions.state.entities.get('model:counters/legacy-customer/mapped-memory'),
      ).toEqual(
        expect.objectContaining({
          state: { id: 'mapped-memory', displayName: 'Mapped', active: true },
          version: 1,
        }),
      )
    } finally {
      await harness.shutdown()
    }
  })

  it('matches typed query, cursor, and eager-relationship semantics in memory', async () => {
    const transactions = new MemoryTransactionManager()
    const harness = await DoxaTestHarness.boot(Application, {
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
      for (const [id, value] of [
        ['memory-a', 1],
        ['memory-b', 2],
        ['memory-c', 2],
      ] as const) {
        await harness.action(CreateCounter, { id, value })
        await harness.action(RenameCounter, { id, label: 'memory-group' })
      }
      await harness.action(CreateCounter, { id: 'memory-unlabeled', value: 0 })
      await harness.action(SaveLegacyCustomer, { id: 'memory-zed', displayName: 'Zed' })
      await harness.action(SaveLegacyCustomer, { id: 'memory-ada', displayName: 'Ada' })
      await harness.action(CreateCounterNote, {
        id: 'memory-note-2',
        counterId: 'memory-a',
        body: 'Second',
        rank: 2,
      })
      await harness.action(CreateCounterNote, {
        id: 'memory-note-1',
        counterId: 'memory-a',
        body: 'First',
        rank: 1,
      })
      await harness.action(CreateCounterNote, {
        id: 'memory-note-3',
        counterId: 'memory-c',
        body: 'Third',
        rank: 3,
      })
      await harness.action(AssignCounterTag, {
        id: 'memory-assignment-a-z',
        counterId: 'memory-a',
        tagId: 'memory-tag-z',
        tagName: 'Zeta',
      })
      await harness.action(AssignCounterTag, {
        id: 'memory-assignment-a-a',
        counterId: 'memory-a',
        tagId: 'memory-tag-a',
        tagName: 'Alpha',
      })
      await harness.action(AssignCounterTag, {
        id: 'memory-assignment-c-a',
        counterId: 'memory-c',
        tagId: 'memory-tag-a',
        tagName: 'Alpha',
      })

      expect(
        await harness.query(InspectCounterQueries, {
          minimumValue: 1,
          constrainedNoteRank: 2,
          page: 2,
          perPage: 2,
          cursorSize: 2,
        }),
      ).toEqual(
        expect.objectContaining({
          orderedIds: ['memory-a', 'memory-b', 'memory-c'],
          count: 3,
          totalValue: 5,
          pageIds: ['memory-c'],
          cursorIds: ['memory-a', 'memory-b'],
          nextCursorIds: ['memory-c'],
          previousCursorIds: ['memory-a', 'memory-b'],
          invalidCursorError: 'InvalidModelCursorError',
          eagerNotes: {
            'memory-a': ['First', 'Second'],
            'memory-b': [],
            'memory-c': ['Third'],
          },
          primaryNotes: {
            'memory-a': 'First',
            'memory-b': undefined,
            'memory-c': 'Third',
          },
          eagerTags: {
            'memory-a': ['Alpha', 'Zeta'],
            'memory-b': [],
            'memory-c': ['Alpha'],
          },
          hasNotes: ['memory-a', 'memory-c'],
          constrainedHasNotes: ['memory-a', 'memory-c'],
          identityMapped: true,
          readOnlyError: 'ReadOnlyExecutionError',
          readOnlyErrors: [
            'ReadOnlyExecutionError',
            'ReadOnlyExecutionError',
            'ReadOnlyExecutionError',
          ],
          iteratedIds: ['memory-a', 'memory-b', 'memory-c'],
          filteredIds: ['memory-a', 'memory-b', 'memory-c'],
          mappedCustomerIds: ['memory-ada', 'memory-zed'],
          nestedIdentityMapped: true,
          hasTags: ['memory-a', 'memory-c'],
          belongsToNoteIds: ['memory-note-1', 'memory-note-2'],
          staticWithIdentityMapped: true,
          booleanIds: ['memory-a', 'memory-c'],
          patternIds: ['memory-a', 'memory-b', 'memory-c'],
          nullLabelIds: ['memory-unlabeled'],
          notInIds: ['memory-b', 'memory-c'],
          columnComparisonCount: 0,
        }),
      )
      expect(harness.observations?.observations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'model',
            name: 'query',
            phase: 'occurred',
            roleId: 'model:counters/counter',
            attributes: expect.objectContaining({
              model: 'Counter',
              terminal: 'get',
              constraintCount: 1,
              ordering: ['value:asc', 'id:asc'],
              eagerLoads: ['notes', 'primaryNote', 'tags', 'notes.counter'],
              storage: { kind: 'entity-state' },
            }),
          }),
        ]),
      )
    } finally {
      await harness.shutdown()
    }
  })

  it('drives events, signals, jobs, and schedules through first-party test APIs', async () => {
    resetRecordedEvents()
    resetRecordedJobAttempts()
    const queue = new FakeQueueManager()
    const transactions = new MemoryTransactionManager(queue)
    const harness = await DoxaTestHarness.boot(Application, {
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
      harness.events.fake([CounterIncremented])
      await harness.event(CounterIncremented, {
        counterId: 'faked-event',
        amount: 1,
        value: 1,
      })
      harness.events.assertDispatched(
        CounterIncremented,
        (event) => event.payload.counterId === 'faked-event',
      )
      harness.events.assertNotDispatched(CounterCreated)
      harness.events.assertListening(CounterIncremented, RecordCounterIncremented)
      expect(recordedEvents.some((event) => event.event === 'counter-incremented')).toBe(false)
      harness.events.restore().clear()

      resetRecordedEvents()
      harness.events.fake([CounterSaved])
      await harness.action(SaveCounter, { id: 'faked-after-commit', amount: 2 })
      harness.events.assertDispatched(CounterSaved)
      expect(recordedEvents.some((event) => event.event === 'counter-saved')).toBe(false)
      harness.events.restore().clear()

      await harness.event(CounterIncremented, { counterId: 'direct-event', amount: 2, value: 2 })
      await harness.signal(CounterTouched, { counterId: 'direct-signal' })
      const jobId = await harness.job(ProcessCounterJob, { key: 'direct-job' })
      expect(queue.hasQueued(ProcessCounterJob)).toBe(true)
      await queue.runNext()
      await queue.runSchedule('schedule:counters/process-counters')
      expect(recordedEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ event: 'counter-incremented', value: 2 }),
          expect.objectContaining({ event: 'counter-touched:direct-signal', phase: 'signal' }),
        ]),
      )
      expect(recordedJobAttempts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ jobId, key: 'direct-job' }),
          expect.objectContaining({
            key: 'scheduled-counter-sweep',
            causationId: 'schedule:counters/process-counters',
          }),
        ]),
      )
    } finally {
      await harness.shutdown()
    }
  })
})
