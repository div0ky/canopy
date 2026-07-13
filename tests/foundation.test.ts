import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { compileApplication } from '@doxajs/compiler'
import {
  MemoryCache,
  RoleInjectionError,
  SecretString,
  sanitizeObservationAttributes,
  sanitizeObservationError,
} from '@doxajs/core'
import {
  Doxa,
  ConfigurationValidationError,
  ExecutionAdmissionError,
  OperationDispatchError,
  ReadOnlyExecutionError,
  RuntimeBootError,
  RuntimeIntegrityError,
} from '@doxajs/runtime'
import { PostgresTheoria } from '@doxajs/theoria'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { Application } from '../examples/reference-app/dist/application.js'
import { FailCounter } from '../examples/reference-app/dist/fail-counter.js'
import { IncrementCounter } from '../examples/reference-app/dist/increment-counter.js'
import { lifecycleLog, resetLifecycleLog } from '../examples/reference-app/dist/lifecycle-log.js'
import { NestedCounter } from '../examples/reference-app/dist/nested-counter.js'
import { MutateCounterQuery } from '../examples/reference-app/dist/mutate-counter-query.js'
import { operationLog, resetOperationLog } from '../examples/reference-app/dist/operation-log.js'
import { ReadCounter } from '../examples/reference-app/dist/read-counter.js'

const workspace = path.resolve(import.meta.dirname, '..')
const referenceApplication = path.join(workspace, 'examples/reference-app')
const temporaryDirectories: string[] = []

describe('foundational compile-to-boot slice', () => {
  beforeEach(() => {
    resetLifecycleLog()
    resetOperationLog()
  })

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) =>
        rm(directory, {
          recursive: true,
          force: true,
        }),
      ),
    )
  })

  it('requires explicit reveal for secret configuration values', () => {
    const secret = SecretString.from('database-password')
    expect(String(secret)).toBe('[REDACTED]')
    expect(JSON.stringify({ secret })).toBe('{"secret":"[REDACTED]"}')
    expect(secret.reveal()).toBe('database-password')
  })

  it('recursively redacts observation evidence before a recorder can receive it', () => {
    const attributes = sanitizeObservationAttributes({
      email: 'ada@example.com',
      password: 'correct horse battery staple',
      headers: { authorization: 'Bearer dangerously-visible', accept: 'application/json' },
      database: 'postgresql://doxa:private@localhost/doxa',
      circular: (() => {
        const value: Record<string, unknown> = {}
        value.self = value
        return value
      })(),
    })
    expect(attributes).toEqual(
      expect.objectContaining({
        email: 'ada@example.com',
        password: '[REDACTED]',
        headers: { authorization: '[REDACTED]', accept: 'application/json' },
        database: 'postgresql://doxa:[REDACTED]@localhost/doxa',
        circular: { self: '[CIRCULAR]' },
      }),
    )
    expect(sanitizeObservationError(new Error('token=visible-secret')).message).toBe(
      'token=[REDACTED]',
    )
  })

  it('requires an explicit production override before Theoria can start', async () => {
    const recorder = new PostgresTheoria({
      connectionString: 'postgresql://unused:unused@127.0.0.1:1/unused',
      environment: 'production',
    })
    await expect(
      recorder.start({
        signal: new AbortController().signal,
        deadline: new Date(Date.now() + 1_000),
      }),
    ).rejects.toThrow('disabled in production')
  })

  it('fails clearly when a role with required scoped dependencies is constructed directly', () => {
    expect(() => new IncrementCounter()).toThrow(RoleInjectionError)
  })

  it('provides a deterministic in-memory cache with TTL and atomic-style primitives', async () => {
    let now = 1_000
    const cache = new MemoryCache(() => now)
    expect(await cache.add('counter', 1, { ttlSeconds: 2 })).toBe(true)
    expect(await cache.add('counter', 99)).toBe(false)
    expect(await cache.increment('counter', 2)).toBe(3)
    expect(await cache.remember('label', () => 'first')).toBe('first')
    expect(await cache.remember('label', () => 'second')).toBe('first')
    now = 3_001
    expect(await cache.get('counter')).toBeUndefined()
    expect(await cache.add('counter', 4)).toBe(true)
  })

  it('emits deterministic semantic and constructor-only artifacts', async () => {
    const root = await temporaryDirectory()
    const first = await compile(path.join(root, 'first'))
    const second = await compile(path.join(root, 'second'))
    const firstManifest = await readFile(first.manifestPath, 'utf8')
    const secondManifest = await readFile(second.manifestPath, 'utf8')
    const firstRegistry = await readFile(first.registryPath, 'utf8')
    const secondRegistry = await readFile(second.registryPath, 'utf8')

    expect(firstManifest).toBe(secondManifest)
    expect(firstRegistry).toBe(secondRegistry)
    expect(first.manifest.applicationId).toBe('reference-app')
    expect(first.manifest.features.map((feature) => feature.id)).toEqual(['operations'])
    expect(
      first.manifest.configurations
        .flatMap((configuration) => configuration.properties)
        .map((property) => property.environmentKey),
    ).toEqual(['APP_ENVIRONMENT', 'APP_PORT', 'WORKER_CONCURRENCY', 'WORKER_FAIL_STARTUP'])
    expect(first.manifest.providers.map((provider) => [provider.id, provider.scope])).toEqual([
      ['provider:operations/database-connection', 'singleton'],
      ['provider:operations/transactions', 'singleton'],
      ['provider:operations/worker', 'singleton'],
      ['service:operations/execution-counter', 'execution'],
      ['service:operations/task-runner', 'transient'],
    ])
    expect(first.manifest.actions.map((action) => [action.id, action.transactional])).toEqual([
      ['action:operations/fail-counter', true],
      ['action:operations/increment-counter', true],
      ['action:operations/nested-counter', true],
    ])
    expect(first.manifest.queries.map((query) => [query.id, query.transactional])).toEqual([
      ['query:operations/mutate-counter', false],
      ['query:operations/read-counter', false],
    ])
    expect(
      first.manifest.actions.find((action) => action.id.endsWith('/increment-counter'))
        ?.dependencies,
    ).toEqual([
      expect.objectContaining({
        kind: 'role',
        parameter: 'counter',
        targetId: 'service:operations/execution-counter',
      }),
      expect.objectContaining({
        kind: 'role',
        parameter: 'audit',
        token: 'OptionalCounterAudit',
        optional: true,
      }),
    ])
    expect(
      first.manifest.providers.find((provider) => provider.id.endsWith('/execution-counter'))
        ?.dependencies,
    ).toEqual([
      expect.objectContaining({
        kind: 'constructor',
        parameter: 'execution',
        targetId: 'doxa:current-execution',
      }),
    ])
    expect(firstRegistry).not.toContain('dependencies')
    expect(firstRegistry).not.toContain('lifecycle')
  })

  it('boots only from artifacts and follows dependency-derived lifecycle order', async () => {
    const artifactsDirectory = await temporaryDirectory()
    await compile(artifactsDirectory)

    const runtime = await Doxa.boot(Application, {
      artifactsDirectory,
      dotenvPath: false,
      environment: {
        APP_ENVIRONMENT: 'production',
        APP_PORT: '4100',
        WORKER_CONCURRENCY: '4',
      },
    })

    expect(runtime.ready).toBe(true)
    expect(runtime.state).toBe('ready')
    expect(lifecycleLog).toEqual(['start:database:production:4100:frozen=true', 'start:worker:4'])

    const firstShutdown = runtime.shutdown()
    const secondShutdown = runtime.shutdown()
    expect(secondShutdown).toBe(firstShutdown)
    await firstShutdown

    expect(runtime.state).toBe('stopped')
    expect(lifecycleLog).toEqual([
      'start:database:production:4100:frozen=true',
      'start:worker:4',
      'drain:worker',
      'drain:database',
      'stop:worker',
      'stop:database',
      'dispose:worker',
      'dispose:database',
    ])
  })

  it('preserves startup failure and unwinds successfully started dependencies', async () => {
    const artifactsDirectory = await temporaryDirectory()
    await compile(artifactsDirectory)
    const signalListeners = {
      sigint: process.listenerCount('SIGINT'),
      sigterm: process.listenerCount('SIGTERM'),
    }

    await expect(
      Doxa.boot(Application, {
        artifactsDirectory,
        dotenvPath: false,
        environment: { WORKER_FAIL_STARTUP: 'true' },
      }),
    ).rejects.toMatchObject({
      name: RuntimeBootError.name,
      primaryError: expect.objectContaining({
        message: 'Reference worker startup failed.',
      }),
      cleanupErrors: [],
    })

    expect(lifecycleLog).toEqual([
      'start:database:development:3000:frozen=true',
      'start:worker:2',
      'stop:database',
      'dispose:database',
    ])
    expect(process.listenerCount('SIGINT')).toBe(signalListeners.sigint)
    expect(process.listenerCount('SIGTERM')).toBe(signalListeners.sigterm)
  })

  it('aggregates configuration failures before constructing singleton services', async () => {
    const artifactsDirectory = await temporaryDirectory()
    await compile(artifactsDirectory)

    await expect(
      Doxa.boot(Application, {
        artifactsDirectory,
        dotenvPath: false,
        environment: {
          APP_ENVIRONMENT: 'staging',
          APP_PORT: 'not-a-number',
        },
      }),
    ).rejects.toMatchObject({
      name: ConfigurationValidationError.name,
      issues: expect.arrayContaining([
        expect.stringContaining('AppConfig.environment'),
        expect.stringContaining('AppConfig.port'),
      ]),
    })
    expect(lifecycleLog).toEqual([])
  })

  it('fails closed when manifest and registry integrity diverge', async () => {
    const artifactsDirectory = await temporaryDirectory()
    const result = await compile(artifactsDirectory)
    const manifest = JSON.parse(await readFile(result.manifestPath, 'utf8')) as Record<
      string,
      unknown
    >
    manifest.buildHash = 'stale-build-hash'
    await writeFile(result.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

    await expect(
      Doxa.boot(Application, {
        artifactsDirectory,
        dotenvPath: false,
        environment: {},
      }),
    ).rejects.toBeInstanceOf(RuntimeIntegrityError)
  })

  it('fails closed when semantic manifest content is modified', async () => {
    const artifactsDirectory = await temporaryDirectory()
    const result = await compile(artifactsDirectory)
    const manifest = JSON.parse(await readFile(result.manifestPath, 'utf8')) as {
      actions: Array<{ transactional: boolean }>
    }
    manifest.actions[0]!.transactional = false
    await writeFile(result.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

    await expect(
      Doxa.boot(Application, {
        artifactsDirectory,
        dotenvPath: false,
        environment: {},
      }),
    ).rejects.toThrow('manifest content does not match its build hash')
  })

  it('rejects stale manifest formats before interpreting new graph sections', async () => {
    const artifactsDirectory = await temporaryDirectory()
    const result = await compile(artifactsDirectory)
    const manifest = JSON.parse(await readFile(result.manifestPath, 'utf8')) as {
      formatVersion: number
    }
    const expectedFormatVersion = manifest.formatVersion
    manifest.formatVersion = expectedFormatVersion - 1
    await writeFile(result.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

    await expect(
      Doxa.boot(Application, {
        artifactsDirectory,
        dotenvPath: false,
        environment: {},
      }),
    ).rejects.toThrow(
      `Unsupported Doxa manifest format ${expectedFormatVersion - 1}; expected ${expectedFormatVersion}`,
    )
  })

  it('rejects an Application constructor that does not match the generated registry', async () => {
    const artifactsDirectory = await temporaryDirectory()
    await compile(artifactsDirectory)
    class DifferentApplication extends Application {}

    await expect(
      Doxa.boot(DifferentApplication, {
        artifactsDirectory,
        dotenvPath: false,
        environment: {},
      }),
    ).rejects.toThrow('not the Application passed to Doxa.boot()')
  })

  it('shares one execution-scoped service across actions and queries', async () => {
    const runtime = await bootRuntime()
    const result = await runtime.admit(
      {
        actor: { kind: 'user', id: 'user-1' },
        transport: { kind: 'test' },
      },
      async (context) => {
        expect(Object.isFrozen(context)).toBe(true)
        expect(Object.isFrozen(context.actor)).toBe(true)
        expect(context.initiator).toEqual(context.actor)
        expect(context.correlationId).toBe(context.executionId)

        const first = await runtime.actions.execute(IncrementCounter, { amount: 2 })
        const read = await runtime.queries.execute(ReadCounter, undefined)
        const second = await runtime.actions.execute(IncrementCounter, { amount: 3 })
        return { context, values: [first, read, second] }
      },
    )

    expect(result.values).toEqual([2, 2, 5])
    expect(operationLog).toEqual([
      `transaction:begin:${result.context.executionId}`,
      `transaction:commit:${result.context.executionId}`,
      `transaction:begin:${result.context.executionId}`,
      `transaction:commit:${result.context.executionId}`,
      'execution-counter:dispose:5',
    ])
    await runtime.shutdown()
  })

  it('isolates concurrent executions and gives each a new execution ID', async () => {
    const runtime = await bootRuntime()
    const executions = await Promise.all([
      runtime.admit(
        {
          actor: { kind: 'service', id: 'first' },
          transport: { kind: 'test' },
        },
        async (context) => ({
          id: context.executionId,
          value: await runtime.actions.execute(IncrementCounter, { amount: 1, delay: 15 }),
        }),
      ),
      runtime.admit(
        {
          actor: { kind: 'service', id: 'second' },
          transport: { kind: 'test' },
        },
        async (context) => ({
          id: context.executionId,
          value: await runtime.actions.execute(IncrementCounter, { amount: 10 }),
        }),
      ),
    ])

    expect(executions.map((execution) => execution.value)).toEqual([1, 10])
    expect(new Set(executions.map((execution) => execution.id)).size).toBe(2)
    expect(operationLog).toEqual(
      expect.arrayContaining(['execution-counter:dispose:1', 'execution-counter:dispose:10']),
    )
    await runtime.shutdown()
  })

  it('rolls back failed actions and disposes their execution scope', async () => {
    const runtime = await bootRuntime()
    let executionId = ''

    await expect(
      runtime.admit(
        {
          actor: { kind: 'system', id: 'failure-test' },
          transport: { kind: 'test' },
        },
        async (context) => {
          executionId = context.executionId
          return runtime.actions.execute(FailCounter, 7)
        },
      ),
    ).rejects.toThrow('Counter action failed.')

    expect(operationLog).toEqual([
      `transaction:begin:${executionId}`,
      `transaction:rollback:${executionId}`,
      'execution-counter:dispose:7',
    ])
    await runtime.shutdown()
  })

  it('marks query execution read-only for framework-managed mutation paths', async () => {
    const runtime = await bootRuntime()

    await expect(
      runtime.admit(
        {
          actor: { kind: 'system', id: 'read-only-test' },
          transport: { kind: 'test' },
        },
        () => runtime.queries.execute(MutateCounterQuery, 3),
      ),
    ).rejects.toBeInstanceOf(ReadOnlyExecutionError)

    expect(operationLog).toEqual(['execution-counter:dispose:0'])
    await runtime.shutdown()
  })

  it('prohibits nested action dispatch and dispatch outside an execution', async () => {
    const runtime = await bootRuntime()
    await expect(runtime.actions.execute(IncrementCounter, { amount: 1 })).rejects.toBeInstanceOf(
      OperationDispatchError,
    )

    await expect(
      runtime.admit(
        {
          actor: { kind: 'system', id: 'nested-test' },
          transport: { kind: 'test' },
        },
        () => runtime.actions.execute(NestedCounter, 1),
      ),
    ).rejects.toThrow('Nested action dispatch is prohibited')
    expect(operationLog.some((entry) => entry.startsWith('transaction:rollback:'))).toBe(true)
    await runtime.shutdown()
  })

  it('rejects invalid actors and nested admitted execution scopes', async () => {
    const runtime = await bootRuntime()
    await expect(
      runtime.admit(
        {
          actor: { kind: 'anonymous', id: 'not-allowed' },
          transport: { kind: 'test' },
        },
        () => undefined,
      ),
    ).rejects.toBeInstanceOf(ExecutionAdmissionError)

    await expect(
      runtime.admit(
        {
          actor: { kind: 'system', id: 'outer' },
          transport: { kind: 'test' },
        },
        () =>
          runtime.admit(
            {
              actor: { kind: 'system', id: 'inner' },
              transport: { kind: 'internal' },
            },
            () => undefined,
          ),
      ),
    ).rejects.toThrow('cannot create a nested execution scope')
    await runtime.shutdown()
  })

  it('stops admission during drain and waits for accepted execution work', async () => {
    const runtime = await bootRuntime()
    let release!: () => void
    let markStarted!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    const execution = runtime.admit(
      {
        actor: { kind: 'system', id: 'drain-test' },
        transport: { kind: 'test' },
      },
      async () => {
        markStarted()
        await gate
        return 'complete'
      },
    )
    await started

    const shutdown = runtime.shutdown()
    expect(runtime.state).toBe('draining')
    await expect(
      runtime.admit(
        {
          actor: { kind: 'system', id: 'too-late' },
          transport: { kind: 'test' },
        },
        () => undefined,
      ),
    ).rejects.toBeInstanceOf(ExecutionAdmissionError)
    release()

    await expect(execution).resolves.toBe('complete')
    await shutdown
    expect(runtime.state).toBe('stopped')
  })

  it('propagates execution deadlines through the cancellation signal', async () => {
    const runtime = await bootRuntime()
    const aborted = await runtime.admit(
      {
        actor: { kind: 'system', id: 'deadline-test' },
        transport: { kind: 'test' },
        deadline: new Date(Date.now() + 10),
      },
      async (context) => {
        if (!context.cancellation.aborted) {
          await new Promise<void>((resolve) => {
            context.cancellation.addEventListener('abort', () => resolve(), { once: true })
          })
        }
        return context.cancellation.aborted
      },
    )

    expect(aborted).toBe(true)
    await runtime.shutdown()
  })
})

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'doxa-foundation-'))
  temporaryDirectories.push(directory)
  return directory
}

async function compile(artifactsDirectory: string) {
  return compileApplication({
    tsconfigPath: path.join(referenceApplication, 'tsconfig.json'),
    applicationFile: path.join(referenceApplication, 'src/application.ts'),
    sourceRoot: path.join(referenceApplication, 'src'),
    outputRoot: path.join(referenceApplication, 'dist'),
    artifactsDirectory,
  })
}

async function bootRuntime() {
  const artifactsDirectory = await temporaryDirectory()
  await compile(artifactsDirectory)
  return Doxa.boot(Application, {
    artifactsDirectory,
    dotenvPath: false,
    environment: {},
  })
}
