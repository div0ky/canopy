import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  ActionBus,
  Auth,
  Authorization,
  AuthorizationError,
  QueryBus,
  type Action,
  type ActionClass,
  type ActorRef,
  type CanopyApplication,
  type Command,
  CurrentExecution,
  CurrentJob,
  type Event,
  type ExecutionContext,
  type ExecutionContextSeed,
  HttpRequest,
  type Job,
  type JobConstructor,
  type JobDispatchOptions,
  type LifecycleContext,
  type Listener,
  Mailer,
  Logger,
  ConsoleLogSink,
  type ConsoleLogSinkOptions,
  type LogLevel,
  type LogSink,
  type MailMessage,
  type MailTransport,
  type Model,
  type ModelObserverDispatcher,
  type ModelObserverPhase,
  type Query,
  type QueryClass,
  type OperationMode,
  type Observer,
  type Policy,
  type PolicyDecision,
  ReadOnlyExecutionError,
  type QueueDelivery,
  type QueueEnvelope,
  type QueueExecutionEnvelope,
  QueueManager,
  type ScheduleDefinition,
  type Route,
  type ResolvedHttpAuthentication,
  SecretString,
  Sms,
  type SmsMessage,
  type SmsTransport,
  DeliveryError,
  DeliveryLedger,
  type DeliveryTransition,
  type Signal,
  type SignalHandler,
  type TransactionManager,
  type Telemetry,
  NoopTelemetry,
  type TelemetryRecord,
  UnitOfWork,
} from '@canopy/core'
import {
  type EventDispatcher,
  type JobDispatcher,
  ModelSession,
  runWithEventDispatcher,
  runWithJobDispatcher,
  runWithLogContext,
  runWithModelSession,
  runWithSignalDispatcher,
  type SignalDispatcher,
} from '@canopy/core/runtime'
import {
  MANIFEST_FORMAT_VERSION,
  assertManifest,
  canonicalJson,
  type CanopyManifest,
  type CommandManifestEntry,
  type ConfigurationDefault,
  type ConfigurationManifestEntry,
  type ConfigurationPropertyManifest,
  type EventManifestEntry,
  type ListenerManifestEntry,
  type JobManifestEntry,
  type OperationManifestEntry,
  type ObserverManifestEntry,
  type ProviderManifestEntry,
  type PolicyManifestEntry,
  type RegistryModule,
  type RouteManifestEntry,
  type SignalHandlerManifestEntry,
} from '@canopy/manifest'

export type RuntimeState = 'booting' | 'ready' | 'draining' | 'stopping' | 'disposing' | 'stopped'

type ApplicationDeclaration = abstract new () => CanopyApplication

export interface BootOptions {
  readonly artifactsDirectory?: string
  readonly environment?: Readonly<Record<string, string | undefined>>
  readonly dotenvPath?: string | false
  readonly configurationOverrides?: Readonly<Record<string, Readonly<Record<string, unknown>>>>
  readonly deadlines?: Partial<LifecycleDeadlines>
  readonly roles?: Partial<{ readonly worker: boolean; readonly scheduler: boolean }>
  readonly providerOverrides?: Readonly<Record<string, object>>
  readonly logging?: false | {
    readonly level?: LogLevel
    readonly sink?: LogSink
    readonly format?: ConsoleLogSinkOptions['format']
    readonly color?: boolean
    readonly destination?: ConsoleLogSinkOptions['destination']
  }
}

interface LifecycleDeadlines {
  readonly start: number
  readonly drain: number
  readonly stop: number
  readonly dispose: number
}

const DEFAULT_DEADLINES: LifecycleDeadlines = {
  start: 10_000,
  drain: 10_000,
  stop: 10_000,
  dispose: 10_000,
}

interface RuntimeArtifacts {
  readonly manifest: CanopyManifest
  readonly registry: RegistryModule
}

interface LifecycleParticipant {
  readonly manifest: Pick<
    ProviderManifestEntry | OperationManifestEntry | RouteManifestEntry | ListenerManifestEntry
      | JobManifestEntry | SignalHandlerManifestEntry | ObserverManifestEntry | CommandManifestEntry,
    'id' | 'lifecycle'
  >
  readonly instance: object
}

interface RuntimeGraph {
  readonly participants: readonly LifecycleParticipant[]
  readonly singletonInstances: ReadonlyMap<string, object>
  readonly configurations: ReadonlyMap<string, object>
}

interface ExecutionStore {
  readonly context: ExecutionContext
  readonly scope: ExecutionScope
  readonly operationStack: ('action' | 'job' | 'query')[]
  job?: import('@canopy/core').CurrentJobContext
}

export class RuntimeIntegrityError extends Error {
  override readonly name = 'RuntimeIntegrityError'
}

export class ConfigurationValidationError extends Error {
  override readonly name = 'ConfigurationValidationError'

  constructor(readonly issues: readonly string[]) {
    super(`Canopy configuration is invalid:\n${issues.map((issue) => `- ${issue}`).join('\n')}`)
  }
}

export class RuntimeBootError extends Error {
  override readonly name = 'RuntimeBootError'

  constructor(
    readonly primaryError: unknown,
    readonly cleanupErrors: readonly unknown[],
  ) {
    super('Canopy failed to boot and completed startup unwind.', { cause: primaryError })
  }
}

export class RuntimeShutdownError extends Error {
  override readonly name = 'RuntimeShutdownError'

  constructor(readonly errors: readonly unknown[]) {
    super(`Canopy shutdown completed with ${errors.length} lifecycle failure(s).`)
  }
}

export class ExecutionAdmissionError extends Error {
  override readonly name = 'ExecutionAdmissionError'
}

export class OperationDispatchError extends Error {
  override readonly name = 'OperationDispatchError'
}

export class ExecutionFailureError extends Error {
  override readonly name = 'ExecutionFailureError'

  constructor(
    readonly primaryError: unknown,
    readonly cleanupErrors: readonly unknown[],
  ) {
    super('Canopy execution failed and scoped cleanup also reported failures.', {
      cause: primaryError,
    })
  }
}

export class ExecutionCleanupError extends Error {
  override readonly name = 'ExecutionCleanupError'

  constructor(readonly cleanupErrors: readonly unknown[]) {
    super(`Canopy execution completed with ${cleanupErrors.length} scoped cleanup failure(s).`)
  }
}

export class CanopyRuntime {
  #state: RuntimeState = 'booting'
  #shutdownPromise?: Promise<void>
  readonly #storage = new AsyncLocalStorage<ExecutionStore>()
  readonly #activeExecutions = new Map<Promise<unknown>, AbortController>()
  readonly #operationsByConstructor = new Map<Function, OperationManifestEntry>()
  readonly #modelsByConstructor = new Map<Function, { readonly entityType: string; readonly storage: import('@canopy/core').ModelStorage }>()
  readonly #observersByModel = new Map<string, readonly ObserverManifestEntry[]>()
  readonly #eventsByConstructor = new Map<Function, EventManifestEntry>()
  readonly #listenersByEvent = new Map<string, readonly ListenerManifestEntry[]>()
  readonly #routesById = new Map<string, RouteManifestEntry>()
  readonly #eventDispatcher: EventDispatcher
  readonly #signalsByConstructor = new Map<Function, CanopyManifest['signals'][number]>()
  readonly #signalHandlersBySignal = new Map<string, readonly SignalHandlerManifestEntry[]>()
  readonly #signalDispatcher: SignalDispatcher
  readonly #jobsByConstructor = new Map<Function, JobManifestEntry>()
  readonly #jobsById = new Map<string, JobManifestEntry>()
  readonly #policiesByAbility = new Map<string, PolicyManifestEntry>()
  readonly #schedulesById = new Map<string, CanopyManifest['schedules'][number]>()
  readonly #commandsByName = new Map<string, CommandManifestEntry>()
  readonly #jobDispatcher: JobDispatcher
  readonly #currentJob: CurrentJob
  readonly actions: ActionBus
  readonly queries: QueryBus
  readonly mailer: Mailer
  readonly sms: Sms
  readonly deliveryLedger: DeliveryLedger
  readonly logger: Logger
  readonly authorization: Authorization
  readonly #currentExecution: CurrentExecution

  private constructor(
    readonly manifest: CanopyManifest,
    private readonly artifacts: RuntimeArtifacts,
    private readonly graph: RuntimeGraph,
    private readonly participants: readonly LifecycleParticipant[],
    private readonly deadlines: LifecycleDeadlines,
    private readonly transactions: TransactionManager | undefined,
    private readonly queues: QueueManager | undefined,
    private readonly authentication: Auth | undefined,
    private readonly mailTransport: MailTransport | undefined,
    private readonly smsTransport: SmsTransport | undefined,
    private readonly telemetry: Telemetry,
    logger: Logger,
  ) {
    this.logger = logger
    this.actions = new RuntimeActionBus(this)
    this.queries = new RuntimeQueryBus(this)
    this.authorization = new RuntimeAuthorization(this)
    this.mailer = new RuntimeMailer(this)
    this.sms = new RuntimeSms(this)
    this.deliveryLedger = new RuntimeDeliveryLedger(this)
    this.#currentExecution = new RuntimeCurrentExecution(this)
    this.#eventDispatcher = Object.freeze({
      dispatch: (event: Event) => this.dispatchEvent(event),
    })
    this.#signalDispatcher = Object.freeze({
      dispatch: (signal: Signal) => this.dispatchSignal(signal),
    })
    this.#jobDispatcher = Object.freeze({
      dispatch: <Input, Instance extends Job<Input>>(
        Constructor: JobConstructor<Instance, Input>,
        input: Input,
        options?: JobDispatchOptions,
      ) => this.dispatchJob(Constructor, input, options),
    })
    this.#currentJob = new RuntimeCurrentJob(this)
    for (const operation of [...manifest.actions, ...manifest.queries]) {
      const Constructor = artifacts.registry.constructors[operation.id]
      if (Constructor) this.#operationsByConstructor.set(Constructor, operation)
    }
    for (const model of manifest.models) {
      const Constructor = artifacts.registry.constructors[model.id]
      if (Constructor) this.#modelsByConstructor.set(Constructor, { entityType: model.entityType, storage: model.storage })
      this.#observersByModel.set(
        model.id,
        manifest.observers.filter((observer) => observer.modelId === model.id),
      )
    }
    for (const event of manifest.events) {
      const Constructor = artifacts.registry.constructors[event.id]
      if (Constructor) this.#eventsByConstructor.set(Constructor, event)
      this.#listenersByEvent.set(
        event.id,
        manifest.listeners.filter((listener) => listener.eventId === event.id),
      )
    }
    for (const signal of manifest.signals) {
      const Constructor = artifacts.registry.constructors[signal.id]
      if (Constructor) this.#signalsByConstructor.set(Constructor, signal)
      this.#signalHandlersBySignal.set(
        signal.id,
        manifest.signalHandlers.filter((handler) => handler.signalId === signal.id),
      )
    }
    for (const route of manifest.routes) this.#routesById.set(route.id, route)
    for (const job of manifest.jobs) {
      const Constructor = artifacts.registry.constructors[job.id]
      if (Constructor) this.#jobsByConstructor.set(Constructor, job)
      this.#jobsById.set(job.id, job)
    }
    for (const policy of manifest.policies) {
      for (const ability of policy.abilities) this.#policiesByAbility.set(ability, policy)
    }
    for (const schedule of manifest.schedules) this.#schedulesById.set(schedule.id, schedule)
    for (const command of manifest.commands) this.#commandsByName.set(command.command, command)
    queues?.bind((delivery) => this.handleQueueDelivery(delivery))
    queues?.reconcileSchedules(manifest.schedules.map((schedule): ScheduleDefinition => {
      const job = manifest.jobs.find((entry) => entry.id === schedule.jobId)
      if (!job) throw new RuntimeIntegrityError(`Schedule ${schedule.id} targets missing job ${schedule.jobId}.`)
      return {
        id: schedule.id,
        targetId: schedule.jobId,
        cadence: schedule.cadence,
        timeZone: schedule.timeZone,
        overlap: schedule.overlap,
        misfire: schedule.misfire,
        input: schedule.input as import('@canopy/core').JsonValue,
        policy: {
          retries: job.retries,
          retryDelay: job.retryDelay,
          backoff: job.backoff,
          timeout: job.timeout,
        },
      }
    }))
  }

  get state(): RuntimeState {
    return this.#state
  }

  get ready(): boolean {
    return this.#state === 'ready'
  }

  static async boot(
    application: ApplicationDeclaration,
    options: BootOptions,
  ): Promise<CanopyRuntime> {
    const artifactsDirectory = path.resolve(options.artifactsDirectory ?? '.canopy')
    const artifacts = await loadArtifacts(artifactsDirectory)
    const registeredApplication = artifacts.registry.constructors[
      `application:${artifacts.manifest.applicationId}`
    ]
    if (registeredApplication !== application) {
      throw new RuntimeIntegrityError(
        `Generated artifacts belong to ${artifacts.manifest.applicationId}, not the Application passed to Canopy.boot().`,
      )
    }
    const deadlines = { ...DEFAULT_DEADLINES, ...options.deadlines }
    const configurations = await materializeConfigurations(artifacts, options)
    assertOperationInfrastructure(artifacts.manifest)
    const consoleOptions: ConsoleLogSinkOptions = {
      ...(options.logging && options.logging.format ? { format: options.logging.format } : {}),
      ...(options.logging && options.logging.color !== undefined ? { color: options.logging.color } : {}),
      ...(options.logging && options.logging.destination ? { destination: options.logging.destination } : {}),
    }
    const sink = options.logging === false || options.logging === undefined
      ? undefined
      : options.logging?.sink ?? new ConsoleLogSink(consoleOptions)
    const logger = new Logger({
      ...(sink ? { sink } : {}),
      ...(options.logging && options.logging.level ? { level: options.logging.level } : {}),
    })
    logger.channel('lifecycle').debug('Booting application', { application: artifacts.manifest.applicationId })
    const graph = constructSingletonGraph(artifacts, configurations, options.providerOverrides ?? {}, logger)
    const transactionProvider = artifacts.manifest.providers.find(
      (provider) => provider.capabilities.includes('transactions'),
    )
    const transactions = transactionProvider
      ? graph.singletonInstances.get(transactionProvider.id) as TransactionManager | undefined
      : undefined
    const queueProvider = artifacts.manifest.providers.find(
      (provider) => provider.capabilities.includes('queues'),
    )
    const queues = queueProvider
      ? graph.singletonInstances.get(queueProvider.id) as QueueManager | undefined
      : undefined
    const authenticationProvider = artifacts.manifest.providers.find(
      (provider) => provider.capabilities.includes('authentication'),
    )
    const authentication = authenticationProvider
      ? graph.singletonInstances.get(authenticationProvider.id) as Auth | undefined
      : undefined
    const mailProvider = artifacts.manifest.providers.find((provider) => provider.capabilities.includes('mail'))
    const mailTransport = mailProvider ? graph.singletonInstances.get(mailProvider.id) as MailTransport | undefined : undefined
    const smsProvider = artifacts.manifest.providers.find((provider) => provider.capabilities.includes('sms'))
    const smsTransport = smsProvider ? graph.singletonInstances.get(smsProvider.id) as SmsTransport | undefined : undefined
    const telemetryProvider = artifacts.manifest.providers.find((provider) => provider.capabilities.includes('telemetry'))
    const telemetry = telemetryProvider ? graph.singletonInstances.get(telemetryProvider.id) as Telemetry : new NoopTelemetry()
    const runtime = new CanopyRuntime(
      artifacts.manifest,
      artifacts,
      graph,
      graph.participants,
      deadlines,
      transactions,
      queues,
      authentication,
      mailTransport,
      smsTransport,
      telemetry,
      logger,
    )
    queues?.selectRoles({
      worker: options.roles?.worker ?? true,
      scheduler: options.roles?.scheduler ?? true,
    })
    const started: LifecycleParticipant[] = []
    const bootStartedAt = performance.now()

    try {
      for (const participant of graph.participants) {
        if (participant.manifest.lifecycle.start) {
          await runtime.observeTelemetry('lifecycle.phase', { phase: 'start', participant: participant.manifest.id }, () => invokeLifecycle(participant, 'start', deadlines.start))
        }
        started.push(participant)
      }
      runtime.#state = 'ready'
      runtime.logger.channel('lifecycle').info('Application ready', {
        application: artifacts.manifest.applicationId,
        durationMs: performance.now() - bootStartedAt,
      })
      await runtime.recordTelemetry({ kind: 'metric', name: 'canopy.lifecycle.boot.duration', value: performance.now() - bootStartedAt, unit: 'milliseconds', attributes: { status: 'ok' } })
      return runtime
    } catch (primaryError) {
      const cleanupErrors = await unwindStartup(started, deadlines)
      runtime.#state = 'stopped'
      runtime.logger.channel('lifecycle').error('Application boot failed', primaryError, {
        application: artifacts.manifest.applicationId,
        durationMs: performance.now() - bootStartedAt,
      })
      await runtime.recordTelemetry({ kind: 'metric', name: 'canopy.lifecycle.boot.duration', value: performance.now() - bootStartedAt, unit: 'milliseconds', attributes: { status: 'error' } })
      throw new RuntimeBootError(primaryError, cleanupErrors)
    }
  }

  async admit<Output>(
    seed: ExecutionContextSeed,
    work: (context: ExecutionContext) => Output | Promise<Output>,
  ): Promise<Output> {
    if (this.#state !== 'ready') {
      throw new ExecutionAdmissionError(`Canopy cannot admit work while runtime state is ${this.#state}.`)
    }
    if (this.#storage.getStore()) {
      throw new ExecutionAdmissionError('An admitted execution cannot create a nested execution scope.')
    }

    const controller = new AbortController()
    let deadlineTimer: NodeJS.Timeout | undefined
    if (seed.deadline) {
      deadlineTimer = setTimeout(
        () => controller.abort(new Error('Canopy execution deadline exceeded.')),
        Math.max(0, seed.deadline.getTime() - Date.now()),
      )
      deadlineTimer.unref()
    }
    const context = createExecutionContext(seed, controller.signal)
    const startedAt = performance.now()
    runWithLogContext(logContext(context), () => {
      this.logger.channel(logChannelForTransport(context.transport.kind)).debug('Execution started', {
        transport: context.transport.name ?? context.transport.kind,
      })
    })
    await this.recordTelemetry({
      kind: 'log', level: 'info', event: 'execution.started', attributes: telemetryAttributes(context),
    })
    await this.recordTelemetry({
      kind: 'metric', name: 'canopy.execution.admitted', value: 1, unit: 'count', attributes: { transport: context.transport.kind },
    })
    const scope = new ExecutionScope(
      this.artifacts,
      this.graph,
      this.actions,
      this.queries,
      this.#currentExecution,
      this.#currentJob,
      this.authorization,
      this.mailer,
      this.sms,
      this.deliveryLedger,
      this.logger,
    )
    const store: ExecutionStore = { context, scope, operationStack: [] }
    const execution = Promise.resolve(this.#storage.run(store, () => runWithLogContext(logContext(context), () => runWithEventDispatcher(
      this.#eventDispatcher,
      () => runWithSignalDispatcher(this.#signalDispatcher, () => runWithJobDispatcher(this.#jobDispatcher, async () => {
        let result: Output | undefined
        let primaryError: unknown
        let failed = false
        try {
          result = await work(context)
        } catch (error) {
          failed = true
          primaryError = error
        }

        const cleanupErrors = await scope.dispose(this.deadlines.dispose)
        if (failed && cleanupErrors.length > 0) {
          throw new ExecutionFailureError(primaryError, cleanupErrors)
        }
        if (failed) throw primaryError
        if (cleanupErrors.length > 0) throw new ExecutionCleanupError(cleanupErrors)
        return result as Output
      })),
    ))))
    this.#activeExecutions.set(execution, controller)
    try {
      const result = await execution
      await this.completeTelemetry(context, startedAt, 'ok')
      return result
    } catch (error) {
      await this.completeTelemetry(context, startedAt, 'error', error)
      throw error
    } finally {
      this.#activeExecutions.delete(execution)
      if (deadlineTimer) clearTimeout(deadlineTimer)
    }
  }

  private async completeTelemetry(context: ExecutionContext, startedAt: number, status: 'ok' | 'error', error?: unknown): Promise<void> {
    const durationMilliseconds = performance.now() - startedAt
    const attributes = telemetryAttributes(context)
    const executionLogger = this.logger.channel(logChannelForTransport(context.transport.kind))
    const logAttributes = {
      transport: context.transport.name ?? context.transport.kind,
      durationMs: durationMilliseconds,
    }
    runWithLogContext(logContext(context), () => {
      if (status === 'ok' && context.transport.kind === 'http') executionLogger.debug('Execution completed', logAttributes)
      else if (status === 'ok') executionLogger.info('Execution completed', logAttributes)
      else executionLogger.error('Execution failed', error, logAttributes)
    })
    await this.recordTelemetry({ kind: 'log', level: status === 'ok' ? 'info' : 'error', event: `execution.${status === 'ok' ? 'completed' : 'failed'}`, attributes })
    await this.recordTelemetry({ kind: 'metric', name: 'canopy.execution.duration', value: durationMilliseconds, unit: 'milliseconds', attributes: { transport: context.transport.kind, status } })
    await this.recordTelemetry({
      kind: 'span', name: context.transport.name ?? context.transport.kind,
      traceId: context.trace.traceId!, spanId: context.trace.spanId!, durationMilliseconds, status, attributes,
    })
  }

  private async recordTelemetry(record: TelemetryRecord): Promise<void> {
    try { await this.telemetry.record(record) } catch { /* Observability never changes application behavior. */ }
  }

  private async observeTelemetry<Output>(
    subsystem: string,
    attributes: Readonly<Record<string, string | number | boolean>>,
    work: () => Output | Promise<Output>,
  ): Promise<Output> {
    const startedAt = performance.now()
    const logger = this.logger.channel(logChannelForSubsystem(subsystem))
    logger.debug(`${humanizeSubsystem(subsystem)} started`, attributes)
    try {
      const output = await work()
      logger.debug(`${humanizeSubsystem(subsystem)} completed`, { ...attributes, durationMs: performance.now() - startedAt })
      await this.recordTelemetry({ kind: 'metric', name: `canopy.${subsystem}.total`, value: 1, unit: 'count', attributes: { ...attributes, status: 'ok' } })
      await this.recordTelemetry({ kind: 'metric', name: `canopy.${subsystem}.duration`, value: performance.now() - startedAt, unit: 'milliseconds', attributes: { ...attributes, status: 'ok' } })
      return output
    } catch (error) {
      logger.error(`${humanizeSubsystem(subsystem)} failed`, error, { ...attributes, durationMs: performance.now() - startedAt })
      await this.recordTelemetry({ kind: 'metric', name: `canopy.${subsystem}.total`, value: 1, unit: 'count', attributes: { ...attributes, status: 'error' } })
      await this.recordTelemetry({ kind: 'metric', name: `canopy.${subsystem}.duration`, value: performance.now() - startedAt, unit: 'milliseconds', attributes: { ...attributes, status: 'error' } })
      throw error
    }
  }

  async authenticateHttp(request: Request): Promise<ResolvedHttpAuthentication> {
    if (!this.authentication) {
      return {
        actor: { kind: 'anonymous' },
        authentication: { state: 'anonymous' },
      }
    }
    return await this.observeTelemetry('auth.resolve', { transport: 'http' }, () => this.authentication!.resolveHttp(request))
  }

  authenticationStorage(): import('@canopy/core').AuthStorageDescription {
    return this.authentication?.storage() ?? { kind: 'custom' }
  }

  async dispatchAction<Input, Output>(
    action: ActionClass<Input, Output>,
    input: Input,
  ): Promise<Awaited<Output>> {
    const store = this.requireExecution('action')
    if (store.operationStack.length > 0) {
      throw new OperationDispatchError('Nested action dispatch is prohibited in the Canopy MVP.')
    }
    const operation = this.operationFor(action, 'action')
    if (!this.transactions) {
      throw new OperationDispatchError('No transaction manager is available for action dispatch.')
    }
    if (operation.access !== 'public') await this.authorization.authorize(operation.access)
    store.operationStack.push('action')
    try {
      return await this.observeLog('action', 'Action', { id: operation.id }, () => this.observeTelemetry('persistence.transaction', { operation: 'action', id: operation.id }, () => this.transactions!.transaction(
        store.context,
        async (unitOfWork) => {
          const models = new ModelSession(
            unitOfWork,
            this.#modelsByConstructor,
            this.modelObserverDispatcher(store),
          )
          return store.scope.withUnitOfWork(unitOfWork, async () => runWithModelSession(models, async () => {
            try {
              const handler = store.scope.resolve(operation.id) as Action<Input, Output>
              return await handler.handle(input) as Awaited<Output>
            } finally {
              models.close()
            }
          }))
        },
      )))
    } finally {
      store.operationStack.pop()
    }
  }

  async dispatchQuery<Input, Output>(
    query: QueryClass<Input, Output>,
    input: Input,
  ): Promise<Awaited<Output>> {
    const store = this.requireExecution('query')
    const operation = this.operationFor(query, 'query')
    if (operation.access !== 'public') await this.authorization.authorize(operation.access)
    const handler = store.scope.resolve(operation.id) as Query<Input, Output>
    store.operationStack.push('query')
    try {
      return await this.observeLog('query', 'Query', { id: operation.id }, () => handler.handle(input)) as Awaited<Output>
    } finally {
      store.operationStack.pop()
    }
  }

  async dispatchRoute(
    routeId: string,
    request: Request,
    params: Readonly<Record<string, string>>,
  ): Promise<unknown> {
    const store = this.requireExecution('HTTP route')
    const route = this.#routesById.get(routeId)
    if (!route) throw new OperationDispatchError(`${routeId} is not a declared HTTP route.`)
    if (route.access !== 'public') await this.authorization.authorize(route.access)
    const handler = store.scope.resolve(route.id) as Route
    return handler.handle(new HttpRequest(request, Object.freeze({ ...params })))
  }

  async dispatchCommand(name: string, arguments_: readonly string[]): Promise<void> {
    const store = this.requireExecution('command')
    const manifest = this.#commandsByName.get(name)
    if (!manifest) throw new OperationDispatchError(`${name} is not a declared application command.`)
    if (manifest.access !== 'public') await this.authorization.authorize(manifest.access)
    const command = store.scope.resolve(manifest.id) as Command
    await command.handle(arguments_)
  }

  private async dispatchEvent(event: Event): Promise<void> {
    const store = this.requireExecution('event')
    const manifest = this.#eventsByConstructor.get(event.constructor)
    if (!manifest) {
      throw new OperationDispatchError(
        `${event.constructor.name || 'Anonymous event'} is not declared by a selected Feature.`,
      )
    }
    const unitOfWork = store.scope.currentUnitOfWork
    if (manifest.dispatch === 'after-commit' && unitOfWork) {
      for (const listener of this.#listenersByEvent.get(manifest.id) ?? []) {
        if (listener.delivery === 'queued' || listener.delivery === 'queued-after-commit') {
          await this.enqueueListener(listener, manifest, event, store)
        }
      }
      unitOfWork.afterCommit(() => this.dispatchEventNow(event, manifest, store, true))
      return
    }
    await this.observeTelemetry('event.dispatch', { id: manifest.id }, () => this.dispatchEventNow(event, manifest, store))
  }

  private async dispatchSignal(signal: Signal): Promise<void> {
    const store = this.requireExecution('signal')
    const manifest = this.#signalsByConstructor.get(signal.constructor)
    if (!manifest) {
      throw new OperationDispatchError(
        `${signal.constructor.name || 'Anonymous signal'} is not declared by a selected Feature.`,
      )
    }
    await this.observeTelemetry('signal.dispatch', { id: manifest.id }, async () => {
      for (const handlerManifest of this.#signalHandlersBySignal.get(manifest.id) ?? []) {
        if (handlerManifest.access !== 'public') {
          await this.authorization.authorize(handlerManifest.access)
        }
        const handler = store.scope.resolve(handlerManifest.id) as SignalHandler
        await handler.handle(signal)
      }
    })
  }

  private modelObserverDispatcher(store: ExecutionStore): ModelObserverDispatcher {
    return Object.freeze({
      dispatch: async (phase: ModelObserverPhase, model: Model): Promise<void> => {
        const definition = this.#modelsByConstructor.get(model.constructor)
        if (!definition) {
          throw new RuntimeIntegrityError(`${model.constructor.name} is not a declared Model.`)
        }
        for (const manifest of this.#observersByModel.get(definition.entityType) ?? []) {
          if (!manifest.phases.includes(phase)) continue
          const observer = store.scope.resolve(manifest.id) as Observer
          await observer[phase](model)
        }
      },
    })
  }

  private async dispatchEventNow(
    event: Event,
    manifest: EventManifestEntry,
    store: ExecutionStore,
    skipQueued = false,
  ): Promise<void> {
    for (const listener of this.#listenersByEvent.get(manifest.id) ?? []) {
      if (listener.delivery === 'queued' || listener.delivery === 'queued-after-commit') {
        if (!skipQueued) await this.enqueueListener(listener, manifest, event, store)
        continue
      }
      const unitOfWork = store.scope.currentUnitOfWork
      if (listener.delivery === 'after-commit' && unitOfWork) {
        unitOfWork.afterCommit(() => this.invokeListener(listener, event, store))
        continue
      }
      await this.invokeListener(listener, event, store)
    }
  }

  private async enqueueListener(
    listener: ListenerManifestEntry,
    eventManifest: EventManifestEntry,
    event: Event,
    store: ExecutionStore,
  ): Promise<void> {
    const envelope = this.createQueueEnvelope({
      kind: 'listener',
      targetId: listener.id,
      eventId: eventManifest.id,
      payload: serializeQueuePayload(event),
      policy: {
        retries: 3,
        retryDelay: 1,
        backoff: true,
        timeout: 30,
      },
    }, store)
    await this.enqueueEnvelope(envelope, store)
  }

  private async dispatchJob<Input, Instance extends Job<Input>>(
    Constructor: JobConstructor<Instance, Input>,
    input: Input,
    options?: JobDispatchOptions,
  ): Promise<string> {
    const store = this.requireExecution('job')
    const manifest = this.#jobsByConstructor.get(Constructor)
    if (!manifest) {
      throw new OperationDispatchError(
        `${Constructor.name || 'Anonymous job'} is not declared by a selected Feature.`,
      )
    }
    const availableAt = options?.delaySeconds === undefined
      ? undefined
      : new Date(Date.now() + options.delaySeconds * 1_000)
    if (options?.delaySeconds !== undefined
      && (!Number.isFinite(options.delaySeconds) || options.delaySeconds < 0)) {
      throw new OperationDispatchError('Job delaySeconds must be a non-negative finite number.')
    }
    const envelope = this.createQueueEnvelope({
      kind: 'job',
      targetId: manifest.id,
      payload: serializeQueuePayload(input),
      policy: {
        retries: manifest.retries,
        retryDelay: manifest.retryDelay,
        backoff: manifest.backoff,
        timeout: manifest.timeout,
      },
      ...(availableAt ? { availableAt: availableAt.toISOString() } : {}),
      ...(options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
    }, store)
    await this.enqueueEnvelope(envelope, store, availableAt)
    this.logger.channel('queue').info('Job queued', {
      id: envelope.id,
      job: manifest.id,
      ...(availableAt ? { availableAt: availableAt.toISOString() } : {}),
    })
    return envelope.id
  }

  async dispatchMail(message: MailMessage): Promise<string> {
    return this.dispatchCommunication('mail', message)
  }

  async dispatchSms(message: SmsMessage): Promise<string> {
    return this.dispatchCommunication('sms', message)
  }

  async recordDelivery(transition: DeliveryTransition): Promise<void> {
    const store = this.requireExecution('delivery ledger')
    const unitOfWork = store.scope.currentUnitOfWork
    if (!unitOfWork) throw new OperationDispatchError('Delivery reconciliation requires a mutating action or job.')
    await unitOfWork.transitionDelivery(transition)
  }

  private async dispatchCommunication(channel: 'mail' | 'sms', message: MailMessage | SmsMessage): Promise<string> {
    const store = this.requireExecution(channel)
    const unitOfWork = store.scope.currentUnitOfWork
    if (!unitOfWork) throw new OperationDispatchError(`${channel} delivery must be queued inside a mutating action or job.`)
    const transport = channel === 'mail' ? this.mailTransport : this.smsTransport
    if (!transport) throw new OperationDispatchError(`No ${channel} transport is configured.`)
    await unitOfWork.stageDelivery({
      id: message.id,
      channel,
      recipients: channel === 'mail' ? (message as MailMessage).to : [(message as SmsMessage).to],
      payload: serializeQueuePayload(message),
    })
    const envelope = this.createQueueEnvelope({
      kind: channel,
      targetId: `canopy:${channel}`,
      payload: serializeQueuePayload(message),
      policy: { retries: 3, retryDelay: 1, backoff: true, timeout: 30 },
    }, store)
    await this.enqueueEnvelope(envelope, store)
    await this.recordTelemetry({ kind: 'metric', name: `canopy.${channel}.queued`, value: 1, unit: 'count', attributes: { channel } })
    return message.id
  }

  private createQueueEnvelope(
    delivery: Omit<QueueEnvelope, 'id' | 'context'>,
    store: ExecutionStore,
  ): QueueEnvelope {
    return {
      id: delivery.idempotencyKey
        ? deterministicJobId(delivery.targetId, delivery.idempotencyKey)
        : randomUUID(),
      ...delivery,
      context: queueContext(store.context),
    }
  }

  private async enqueueEnvelope(
    envelope: QueueEnvelope,
    store: ExecutionStore,
    availableAt?: Date,
  ): Promise<void> {
    if (!this.queues) throw new OperationDispatchError('No queue manager is available.')
    const unitOfWork = store.scope.currentUnitOfWork
    if (unitOfWork) {
      await unitOfWork.enqueue({
        type: 'canopy.queue',
        payload: envelope as unknown as import('@canopy/core').JsonValue,
        ...(availableAt ? { availableAt } : {}),
      })
      return
    }
    await this.queues.enqueue(envelope)
  }

  private async observeLog<Output>(
    channel: string,
    operation: string,
    attributes: Readonly<Record<string, unknown>>,
    work: () => Output | Promise<Output>,
  ): Promise<Output> {
    const logger = this.logger.channel(channel)
    const startedAt = performance.now()
    logger.debug(`${operation} started`, attributes)
    try {
      const output = await work()
      logger.debug(`${operation} completed`, { ...attributes, durationMs: performance.now() - startedAt })
      return output
    } catch (error) {
      logger.error(`${operation} failed`, error, { ...attributes, durationMs: performance.now() - startedAt })
      throw error
    }
  }

  private async handleQueueDelivery(delivery: QueueDelivery): Promise<void> {
    const { envelope, attempt } = delivery
    await this.observeTelemetry('queue.delivery', {
      kind: envelope.kind,
      target: envelope.targetId,
      scheduled: Boolean(envelope.scheduleId),
      attempt,
    }, () => this.admit({
      ...queueSeed(envelope),
      cancellation: delivery.cancellation,
    }, async () => {
      const store = this.requireExecution('job')
      store.job = Object.freeze({
        id: envelope.id,
        attempt,
        maxAttempts: envelope.policy.retries + 1,
        ...(envelope.idempotencyKey ? { idempotencyKey: envelope.idempotencyKey } : {}),
      })
      if (envelope.kind === 'job') {
        const manifest = this.#jobsById.get(envelope.targetId)
        if (!manifest) throw new OperationDispatchError(`Queued job ${envelope.targetId} is not declared.`)
        if (envelope.scheduleId) {
          const schedule = this.#schedulesById.get(envelope.scheduleId)
          if (!schedule) throw new OperationDispatchError(`Schedule ${envelope.scheduleId} is not declared.`)
          if (schedule.access !== 'public') await this.authorization.authorize(schedule.access)
        }
        await this.invokeJob(manifest, envelope.payload, store)
        return
      }
      if (envelope.kind === 'mail' || envelope.kind === 'sms') {
        await this.invokeCommunication(envelope, store)
        return
      }
      const listener = this.manifest.listeners.find((entry) => entry.id === envelope.targetId)
      const eventManifest = envelope.eventId
        ? this.manifest.events.find((entry) => entry.id === envelope.eventId)
        : undefined
      if (!listener || !eventManifest) {
        throw new OperationDispatchError(`Queued listener ${envelope.targetId} is not declared correctly.`)
      }
      const EventConstructor = this.artifacts.registry.constructors[eventManifest.id]
      if (!EventConstructor || typeof envelope.payload !== 'object' || envelope.payload === null
        || Array.isArray(envelope.payload)) {
        throw new OperationDispatchError(`Queued event ${eventManifest.id} cannot be rehydrated.`)
      }
      const event = Object.assign(Object.create(EventConstructor.prototype), envelope.payload) as Event
      await this.invokeListener(listener, event, store)
    }))
  }

  private async invokeCommunication(envelope: QueueEnvelope, store: ExecutionStore): Promise<void> {
    if (!this.transactions) throw new OperationDispatchError('No transaction manager is available for delivery reconciliation.')
    const transport = envelope.kind === 'mail' ? this.mailTransport : this.smsTransport
    if (!transport) throw new OperationDispatchError(`No ${envelope.kind} transport is configured.`)
    try {
      const acceptance = envelope.kind === 'mail'
        ? await (transport as MailTransport).send(envelope.payload as unknown as MailMessage)
        : await (transport as SmsTransport).send(envelope.payload as unknown as SmsMessage)
      await this.transactions.transaction(store.context, (unitOfWork) => unitOfWork.transitionDelivery(acceptance))
    } catch (error) {
      if (!(error instanceof DeliveryError)) throw error
      const state = error.kind === 'suppressed' || error.kind === 'opt-out' ? 'suppressed'
        : error.kind === 'transient' ? 'undelivered' : 'failed'
      await this.transactions.transaction(store.context, (unitOfWork) => unitOfWork.transitionDelivery({
        messageId: String((envelope.payload as { id?: unknown }).id),
        state,
        failureKind: error.kind,
        code: error.code,
      }))
      if (error.kind === 'transient') throw error
    }
  }

  private async invokeJob(
    manifest: JobManifestEntry,
    payload: import('@canopy/core').JsonValue,
    store: ExecutionStore,
  ): Promise<void> {
    if (!this.transactions) {
      throw new OperationDispatchError('No transaction manager is available for job execution.')
    }
    if (manifest.access !== 'public') await this.authorization.authorize(manifest.access)
    store.operationStack.push('job')
    try {
      await this.transactions.transaction(store.context, async (unitOfWork) => {
        const models = new ModelSession(
          unitOfWork,
          this.#modelsByConstructor,
          this.modelObserverDispatcher(store),
        )
        return store.scope.withUnitOfWork(unitOfWork, async () => runWithModelSession(models, async () => {
          try {
            const handler = store.scope.resolve(manifest.id) as Job
            await handler.handle(payload)
          } finally {
            models.close()
          }
        }))
      })
    } finally {
      store.operationStack.pop()
    }
  }

  private async invokeListener(
    manifest: ListenerManifestEntry,
    event: Event,
    store: ExecutionStore,
  ): Promise<void> {
    if (manifest.access !== 'public') await this.authorization.authorize(manifest.access)
    const listener = store.scope.resolve(manifest.id) as Listener
    await listener.handle(event)
  }

  private requireExecution(role: 'action' | 'query' | 'event' | 'signal' | 'job' | 'mail' | 'sms' | 'delivery ledger' | 'command' | 'HTTP route' | 'authorization'): ExecutionStore {
    const store = this.#storage.getStore()
    if (!store) {
      throw new OperationDispatchError(`${role} dispatch requires an active admitted execution.`)
    }
    return store
  }

  currentExecutionContext(): ExecutionContext {
    const store = this.#storage.getStore()
    if (!store) {
      throw new OperationDispatchError('CurrentExecution requires an active admitted execution.')
    }
    return store.context
  }

  currentOperationMode(): OperationMode {
    return this.#storage.getStore()?.operationStack.at(-1)
  }

  currentJobContext(): import('@canopy/core').CurrentJobContext {
    const job = this.#storage.getStore()?.job
    if (!job) throw new OperationDispatchError('CurrentJob requires an active queue execution.')
    return job
  }

  async decideAuthorization<Resource>(ability: string, resource?: Resource): Promise<PolicyDecision> {
    const store = this.requireExecution('authorization')
    const constraints = store.context.authentication.constraints
    if (constraints && constraints.length > 0 && !constraints.some((value) => constraintAllows(value, ability))) {
      return await this.recordAuthorizationDecision(ability, Object.freeze({
        effect: 'deny',
        policy: 'canopy:credential-constraints',
        code: 'credential_constraint_denied',
      }), store.context)
    }
    const manifest = this.#policiesByAbility.get(ability)
    if (!manifest) {
      return await this.recordAuthorizationDecision(ability, Object.freeze({
        effect: 'deny',
        policy: 'canopy:default-deny',
        code: 'policy_missing',
      }), store.context)
    }
    const policy = store.scope.resolve(manifest.id) as Policy<Resource>
    const decision = await policy.decide({
      actor: store.context.actor,
      ability,
      ...(resource === undefined ? {} : { resource }),
      ...(store.context.tenant ? { tenant: store.context.tenant } : {}),
      context: store.context,
    })
    if ((decision.effect !== 'allow' && decision.effect !== 'deny') || !decision.code) {
      throw new RuntimeIntegrityError(`Policy ${manifest.id} returned an invalid decision.`)
    }
    return await this.recordAuthorizationDecision(ability, Object.freeze({
      effect: decision.effect,
      policy: manifest.id,
      code: decision.code,
    }), store.context)
  }

  private async recordAuthorizationDecision(
    ability: string,
    decision: PolicyDecision,
    context: ExecutionContext,
  ): Promise<PolicyDecision> {
    if (this.authentication) {
      await this.authentication.recordAuthorization(ability, decision, context)
    }
    await this.recordTelemetry({
      kind: 'metric', name: 'canopy.authorization.decisions', value: 1, unit: 'count',
      attributes: { ability, effect: decision.effect, policy: decision.policy, code: decision.code },
    })
    this.logger.channel('auth').debug('Authorization decided', {
      ability,
      effect: decision.effect,
      policy: decision.policy,
      code: decision.code,
      actorKind: context.actor.kind,
    })
    return decision
  }

  private operationFor(
    Constructor: Function,
    role: 'action' | 'query',
  ): OperationManifestEntry {
    const operation = this.#operationsByConstructor.get(Constructor)
    if (!operation || operation.role !== role) {
      throw new OperationDispatchError(`${Constructor.name || 'Anonymous class'} is not a declared ${role}.`)
    }
    return operation
  }

  shutdown(): Promise<void> {
    if (this.#shutdownPromise) return this.#shutdownPromise
    if (this.#state === 'stopped') return Promise.resolve()

    this.#shutdownPromise = this.#performShutdown()
    return this.#shutdownPromise
  }

  async #performShutdown(): Promise<void> {
    const startedAt = performance.now()
    this.logger.channel('lifecycle').info('Application shutting down')
    const reverse = [...this.participants].reverse()
    const errors: unknown[] = []
    this.#state = 'draining'
    await this.observeTelemetry('lifecycle.phase', { phase: 'drain', participant: 'runtime' }, () => invokePhase(reverse, 'drain', this.deadlines.drain, errors))
    await this.#drainExecutions(errors)
    this.#state = 'stopping'
    await this.observeTelemetry('lifecycle.phase', { phase: 'stop', participant: 'runtime' }, () => invokePhase(reverse, 'stop', this.deadlines.stop, errors))
    this.#state = 'disposing'
    await this.observeTelemetry('lifecycle.phase', { phase: 'dispose', participant: 'runtime' }, () => invokePhase(reverse, 'dispose', this.deadlines.dispose, errors))
    this.#state = 'stopped'
    if (errors.length > 0) {
      const error = new RuntimeShutdownError(errors)
      this.logger.channel('lifecycle').error('Application shutdown completed with errors', error, {
        durationMs: performance.now() - startedAt,
        errors: errors.length,
      })
      await this.logger.flush()
      throw error
    }
    this.logger.channel('lifecycle').info('Application stopped', { durationMs: performance.now() - startedAt })
    await this.logger.flush()
  }

  async #drainExecutions(errors: unknown[]): Promise<void> {
    if (this.#activeExecutions.size === 0) return
    const executions = [...this.#activeExecutions.keys()]
    let timer: NodeJS.Timeout | undefined
    try {
      await Promise.race([
        Promise.allSettled(executions),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            for (const controller of this.#activeExecutions.values()) controller.abort()
            reject(new Error(`Canopy execution drain exceeded ${this.deadlines.drain}ms.`))
          }, this.deadlines.drain)
          timer.unref()
        }),
      ])
    } catch (error) {
      errors.push(error)
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
}

class RuntimeActionBus extends ActionBus {
  constructor(private readonly runtime: CanopyRuntime) {
    super()
  }

  execute<Input, Output>(
    action: ActionClass<Input, Output>,
    input: Input,
  ): Promise<Awaited<Output>> {
    return this.runtime.dispatchAction(action, input)
  }
}

class RuntimeQueryBus extends QueryBus {
  constructor(private readonly runtime: CanopyRuntime) {
    super()
  }

  execute<Input, Output>(
    query: QueryClass<Input, Output>,
    input: Input,
  ): Promise<Awaited<Output>> {
    return this.runtime.dispatchQuery(query, input)
  }
}

class RuntimeMailer extends Mailer {
  constructor(private readonly runtime: CanopyRuntime) { super() }
  send(message: MailMessage): Promise<string> { return this.runtime.dispatchMail(message) }
}

class RuntimeSms extends Sms {
  constructor(private readonly runtime: CanopyRuntime) { super() }
  send(message: SmsMessage): Promise<string> { return this.runtime.dispatchSms(message) }
}

class RuntimeDeliveryLedger extends DeliveryLedger {
  constructor(private readonly runtime: CanopyRuntime) { super() }
  record(transition: DeliveryTransition): Promise<void> { return this.runtime.recordDelivery(transition) }
}

class RuntimeAuthorization extends Authorization {
  constructor(private readonly runtime: CanopyRuntime) { super() }

  decide<Resource>(ability: string, resource?: Resource): Promise<PolicyDecision> {
    return this.runtime.decideAuthorization(ability, resource)
  }

  async authorize<Resource>(ability: string, resource?: Resource): Promise<void> {
    const decision = await this.decide(ability, resource)
    if (decision.effect === 'deny') throw new AuthorizationError(decision)
  }
}

class RuntimeCurrentExecution extends CurrentExecution {
  constructor(private readonly runtime: CanopyRuntime) {
    super()
  }

  get context(): ExecutionContext {
    return this.runtime.currentExecutionContext()
  }

  get mode(): OperationMode {
    return this.runtime.currentOperationMode()
  }

  assertWritable(): void {
    if (this.mode !== 'action' && this.mode !== 'job') {
      throw new ReadOnlyExecutionError('Mutation requires an active action or job execution.')
    }
  }
}

class RuntimeCurrentJob extends CurrentJob {
  constructor(private readonly runtime: CanopyRuntime) {
    super()
  }

  get context(): import('@canopy/core').CurrentJobContext {
    return this.runtime.currentJobContext()
  }
}

export const Canopy = Object.freeze({
  async boot(
    application: ApplicationDeclaration,
    options: BootOptions = {},
  ): Promise<CanopyRuntime> {
    // Runtime semantics come exclusively from generated artifacts. Constructor identity only
    // proves that the host passed the declaration linked by the matching registry.
    return CanopyRuntime.boot(application, options)
  },
})

async function loadArtifacts(artifactsDirectory: string): Promise<RuntimeArtifacts> {
  const manifestPath = path.join(artifactsDirectory, 'manifest.json')
  const registryPath = path.join(artifactsDirectory, 'registry.mjs')
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(manifestPath, 'utf8'))
  } catch (error) {
    throw new RuntimeIntegrityError(
      `Unable to load ${manifestPath}. Run canopy build before booting. ${errorMessage(error)}`,
    )
  }
  assertManifest(parsed)
  const manifest = parsed
  const { buildHash: declaredBuildHash, ...semanticManifest } = manifest
  const computedBuildHash = createHash('sha256')
    .update(canonicalJson(semanticManifest))
    .digest('hex')
  if (computedBuildHash !== declaredBuildHash) {
    throw new RuntimeIntegrityError('Canopy manifest content does not match its build hash. Run canopy build.')
  }

  let imported: unknown
  try {
    imported = await import(`${pathToFileURL(registryPath).href}?buildHash=${manifest.buildHash}`)
  } catch (error) {
    throw new RuntimeIntegrityError(
      `Unable to load ${registryPath}. Run canopy build before booting. ${errorMessage(error)}`,
    )
  }
  const registry = imported as RegistryModule
  if (registry.formatVersion !== MANIFEST_FORMAT_VERSION) {
    throw new RuntimeIntegrityError(`Registry format ${registry.formatVersion} is not supported.`)
  }
  if (registry.buildHash !== manifest.buildHash) {
    throw new RuntimeIntegrityError('Manifest and registry build hashes do not match. Run canopy build.')
  }

  const expectedIds = [
    `application:${manifest.applicationId}`,
    ...manifest.configurations.map((entry) => entry.id),
    ...manifest.providers.map((entry) => entry.id),
    ...manifest.actions.map((entry) => entry.id),
    ...manifest.queries.map((entry) => entry.id),
    ...manifest.models.map((entry) => entry.id),
    ...manifest.observers.map((entry) => entry.id),
    ...manifest.routes.map((entry) => entry.id),
    ...manifest.events.map((entry) => entry.id),
    ...manifest.listeners.map((entry) => entry.id),
    ...manifest.jobs.map((entry) => entry.id),
    ...manifest.schedules.map((entry) => entry.id),
    ...manifest.policies.map((entry) => entry.id),
    ...manifest.signals.map((entry) => entry.id),
    ...manifest.signalHandlers.map((entry) => entry.id),
    ...manifest.commands.map((entry) => entry.id),
  ]
    .sort()
  const registryIds = Object.keys(registry.constructors ?? {}).sort()
  if (JSON.stringify(expectedIds) !== JSON.stringify(registryIds)) {
    throw new RuntimeIntegrityError('Manifest and registry constructor IDs do not match. Run canopy build.')
  }
  return { manifest, registry }
}

async function materializeConfigurations(
  artifacts: RuntimeArtifacts,
  options: BootOptions,
): Promise<Map<string, object>> {
  const dotenv = options.dotenvPath === false
    ? {}
    : await loadDotenv(path.resolve(options.dotenvPath ?? '.env'))
  const environment = options.environment ?? process.env
  const instances = new Map<string, object>()
  const issues: string[] = []

  for (const configuration of artifacts.manifest.configurations) {
    const Constructor = artifacts.registry.constructors[configuration.id]
    if (!Constructor) throw new RuntimeIntegrityError(`Registry is missing ${configuration.id}.`)
    const instance = Object.create(Constructor.prototype) as Record<string, unknown>
    const overrides = options.configurationOverrides?.[configuration.id] ?? {}

    for (const property of configuration.properties) {
      const source = Object.hasOwn(overrides, property.name)
        ? overrides[property.name]
        : environment[property.environmentKey] !== undefined
          ? environment[property.environmentKey]
          : dotenv[property.environmentKey] !== undefined
            ? dotenv[property.environmentKey]
            : property.defaultValue
      try {
        const value = resolveConfigurationValue(configuration, property, source)
        Object.defineProperty(instance, property.name, {
          value,
          enumerable: true,
          configurable: false,
          writable: false,
        })
      } catch (error) {
        issues.push(
          `${configuration.name}.${property.name} (${property.environmentKey}): ${errorMessage(error)}`,
        )
      }
    }

    instances.set(configuration.id, Object.freeze(instance))
  }

  if (issues.length > 0) throw new ConfigurationValidationError(issues)
  return instances
}

function resolveConfigurationValue(
  configuration: ConfigurationManifestEntry,
  property: ConfigurationPropertyManifest,
  source: unknown,
): ConfigurationDefault | SecretString | undefined {
  if (source === undefined) {
    if (property.optional) return undefined
    throw new Error(`required value is missing for ${configuration.id}`)
  }

  if (property.kind === 'literal-union') {
    const matched = property.allowedValues?.find((allowed) => String(allowed) === String(source))
    if (matched === undefined) {
      throw new Error(`expected one of ${property.allowedValues?.map(String).join(', ')}`)
    }
    return matched
  }
  if (property.kind === 'string') {
    if (typeof source !== 'string') throw new Error('expected a string')
    return source
  }
  if (property.kind === 'secret-string') {
    if (typeof source !== 'string') throw new Error('expected a secret string')
    return SecretString.from(source)
  }
  if (property.kind === 'number') {
    if (typeof source === 'number' && Number.isFinite(source)) return source
    if (typeof source === 'string' && source.trim() !== '') {
      const number = Number(source)
      if (Number.isFinite(number)) return number
    }
    throw new Error('expected a finite number')
  }
  if (typeof source === 'boolean') return source
  if (source === 'true') return true
  if (source === 'false') return false
  throw new Error('expected true or false')
}

function constructSingletonGraph(
  artifacts: RuntimeArtifacts,
  configurations: ReadonlyMap<string, object>,
  overrides: Readonly<Record<string, object>>,
  logger: Logger,
): RuntimeGraph {
  const providerById = new Map(artifacts.manifest.providers.map((provider) => [provider.id, provider]))
  const singletonInstances = new Map<string, object>()
  const constructionStack = new Set<string>()
  const participantOrder: LifecycleParticipant[] = []
  for (const id of Object.keys(overrides)) {
    const provider = providerById.get(id)
    if (!provider || provider.scope !== 'singleton') {
      throw new RuntimeIntegrityError(`Test provider override ${id} is not a declared singleton provider.`)
    }
  }

  const resolve = (id: string): object | undefined => {
    if (id === 'canopy:logger') return logger
    const configuration = configurations.get(id)
    if (configuration) return configuration
    const provider = providerById.get(id)
    if (!provider) return undefined
    if (provider.scope === 'singleton' && singletonInstances.has(id)) {
      return singletonInstances.get(id)
    }
    if (constructionStack.has(id)) {
      throw new RuntimeIntegrityError(`Dependency cycle reached while constructing ${id}.`)
    }
    constructionStack.add(id)
    try {
      const override = overrides[id]
      if (override) {
        for (const dependency of provider.dependencies) {
          if (dependency.targetId) resolve(dependency.targetId)
        }
        singletonInstances.set(id, override)
        participantOrder.push({
          manifest: {
            ...provider,
            lifecycle: {
              start: typeof (override as { start?: unknown }).start === 'function',
              drain: typeof (override as { drain?: unknown }).drain === 'function',
              stop: typeof (override as { stop?: unknown }).stop === 'function',
              dispose: typeof (override as { dispose?: unknown }).dispose === 'function',
            },
          },
          instance: override,
        })
        return override
      }
      const Constructor = artifacts.registry.constructors[id]
      if (!Constructor) throw new RuntimeIntegrityError(`Registry is missing constructor ${id}.`)
      const dependencies = provider.dependencies.map((dependency) => {
        if (!dependency.targetId) return undefined
        const resolved = resolve(dependency.targetId)
        if (resolved === undefined && !dependency.optional) {
          throw new RuntimeIntegrityError(`Required dependency ${dependency.targetId} for ${id} is unavailable.`)
        }
        return resolved
      })
      const instance = new Constructor(...dependencies)
      if (provider.scope === 'singleton') {
        singletonInstances.set(id, instance)
        participantOrder.push({ manifest: provider, instance })
      }
      return instance
    } finally {
      constructionStack.delete(id)
    }
  }

  for (const provider of [...artifacts.manifest.providers].sort((left, right) => left.id.localeCompare(right.id))) {
    if (provider.scope === 'singleton') resolve(provider.id)
  }
  return {
    participants: participantOrder,
    singletonInstances,
    configurations,
  }
}

class ExecutionScope {
  readonly #providerById: ReadonlyMap<string, ProviderManifestEntry>
  readonly #executableById: ReadonlyMap<
    string,
    OperationManifestEntry | RouteManifestEntry | ListenerManifestEntry | JobManifestEntry | PolicyManifestEntry
      | SignalHandlerManifestEntry | ObserverManifestEntry | CommandManifestEntry
  >
  readonly #instances = new Map<string, object>()
  readonly #constructionStack = new Set<string>()
  readonly #disposables: LifecycleParticipant[] = []
  readonly #readOnlyUnitOfWork = new ReadOnlyUnitOfWork()
  #unitOfWork: UnitOfWork | undefined
  #disposed = false

  constructor(
    private readonly artifacts: RuntimeArtifacts,
    private readonly graph: RuntimeGraph,
    private readonly actions: ActionBus,
    private readonly queries: QueryBus,
    private readonly currentExecution: CurrentExecution,
    private readonly currentJob: CurrentJob,
    private readonly authorization: Authorization,
    private readonly mailer: Mailer,
    private readonly sms: Sms,
    private readonly deliveryLedger: DeliveryLedger,
    private readonly logger: Logger,
  ) {
    this.#providerById = new Map(
      artifacts.manifest.providers.map((provider) => [provider.id, provider]),
    )
    this.#executableById = new Map(
      [
        ...artifacts.manifest.actions,
        ...artifacts.manifest.queries,
        ...artifacts.manifest.routes,
        ...artifacts.manifest.listeners,
        ...artifacts.manifest.jobs,
        ...artifacts.manifest.policies,
        ...artifacts.manifest.signalHandlers,
        ...artifacts.manifest.observers,
        ...artifacts.manifest.commands,
      ].map((executable) => [executable.id, executable]),
    )
  }

  resolve(id: string): object | undefined {
    if (this.#disposed) {
      throw new OperationDispatchError('The current execution scope has already been disposed.')
    }
    if (id === 'canopy:action-bus') return this.actions
    if (id === 'canopy:query-bus') return this.queries
    if (id === 'canopy:current-execution') return this.currentExecution
    if (id === 'canopy:current-job') return this.currentJob
    if (id === 'canopy:authorization') return this.authorization
    if (id === 'canopy:mailer') return this.mailer
    if (id === 'canopy:sms') return this.sms
    if (id === 'canopy:delivery-ledger') return this.deliveryLedger
    if (id === 'canopy:logger') return this.logger
    if (id === 'canopy:unit-of-work') return this.#unitOfWork ?? this.#readOnlyUnitOfWork
    const configuration = this.graph.configurations.get(id)
    if (configuration) return configuration
    const singleton = this.graph.singletonInstances.get(id)
    if (singleton) return singleton

    const manifest = this.#providerById.get(id) ?? this.#executableById.get(id)
    if (!manifest) return undefined
    if ('scope' in manifest && manifest.scope === 'execution' && this.#instances.has(id)) {
      return this.#instances.get(id)
    }
    if (this.#constructionStack.has(id)) {
      throw new RuntimeIntegrityError(`Dependency cycle reached while resolving ${id}.`)
    }

    this.#constructionStack.add(id)
    try {
      const Constructor = this.artifacts.registry.constructors[id]
      if (!Constructor) throw new RuntimeIntegrityError(`Registry is missing constructor ${id}.`)
      const dependencies = manifest.dependencies.map((dependency) => {
        if (!dependency.targetId) return undefined
        const resolved = this.resolve(dependency.targetId)
        if (resolved === undefined && !dependency.optional) {
          throw new RuntimeIntegrityError(
            `Required dependency ${dependency.targetId} for ${id} is unavailable.`,
          )
        }
        return resolved
      })
      const instance = new Constructor(...dependencies)
      if (manifest.scope === 'execution') this.#instances.set(id, instance)
      if (manifest.lifecycle.dispose) this.#disposables.push({ manifest, instance })
      return instance
    } finally {
      this.#constructionStack.delete(id)
    }
  }

  async dispose(timeout: number): Promise<readonly unknown[]> {
    if (this.#disposed) return []
    this.#disposed = true
    const errors: unknown[] = []
    await invokePhase([...this.#disposables].reverse(), 'dispose', timeout, errors)
    this.#instances.clear()
    return errors
  }

  async withUnitOfWork<Output>(
    unitOfWork: UnitOfWork,
    work: () => Promise<Output>,
  ): Promise<Output> {
    if (this.#unitOfWork) {
      throw new OperationDispatchError('Nested units of work are prohibited in the Canopy MVP.')
    }
    this.#unitOfWork = unitOfWork
    try {
      return await work()
    } finally {
      this.#unitOfWork = undefined
    }
  }

  get currentUnitOfWork(): UnitOfWork | undefined {
    return this.#unitOfWork
  }
}

class ReadOnlyUnitOfWork extends UnitOfWork {
  findEntity<State extends import('@canopy/core').JsonValue>(
    _type: string,
    _id: string,
  ): Promise<import('@canopy/core').PersistedEntity<State> | undefined> {
    return Promise.reject(this.error())
  }

  saveEntity<State extends import('@canopy/core').JsonValue>(
    _entity: import('@canopy/core').SaveEntity<State>,
  ): Promise<number> {
    return Promise.reject(this.error())
  }

  deleteEntity(_type: string, _id: string, _expectedVersion: number): Promise<void> {
    return Promise.reject(this.error())
  }

  record<Payload extends import('@canopy/core').JsonValue>(
    _fact: import('@canopy/core').JournalFact<Payload>,
  ): Promise<string> {
    return Promise.reject(this.error())
  }

  enqueue<Payload extends import('@canopy/core').JsonValue>(
    _message: import('@canopy/core').OutboxMessage<Payload>,
  ): Promise<string> {
    return Promise.reject(this.error())
  }

  stageDelivery(_delivery: import('@canopy/core').StagedDelivery): Promise<void> {
    return Promise.reject(this.error())
  }

  transitionDelivery(_transition: import('@canopy/core').DeliveryTransition): Promise<void> {
    return Promise.reject(this.error())
  }

  afterCommit(_callback: () => void | Promise<void>): void {
    throw this.error()
  }

  private error(): ReadOnlyExecutionError {
    return new ReadOnlyExecutionError('Unit of Work requires an active action transaction.')
  }
}

function assertOperationInfrastructure(manifest: CanopyManifest): void {
  const transactionProviders = manifest.providers.filter(
    (provider) => provider.capabilities.includes('transactions'),
  )
  if (manifest.actions.length > 0 && transactionProviders.length !== 1) {
    throw new RuntimeIntegrityError(
      `Applications with actions require exactly one transaction provider; found ${transactionProviders.length}.`,
    )
  }
  const queueProviders = manifest.providers.filter(
    (provider) => provider.capabilities.includes('queues'),
  )
  const hasQueuedListeners = manifest.listeners.some(
    (listener) => listener.delivery === 'queued' || listener.delivery === 'queued-after-commit',
  )
  const hasCommunications = manifest.providers.some(
    (provider) => provider.capabilities.includes('mail') || provider.capabilities.includes('sms'),
  )
  if ((manifest.jobs.length > 0 || hasQueuedListeners || hasCommunications) && queueProviders.length !== 1) {
    throw new RuntimeIntegrityError(
      `Applications with jobs or queued listeners require exactly one queue provider; found ${queueProviders.length}.`,
    )
  }
}

function createExecutionContext(
  seed: ExecutionContextSeed,
  runtimeCancellation: AbortSignal,
): ExecutionContext {
  validateActor(seed.actor, 'actor')
  const initiator = seed.initiator ?? seed.actor
  validateActor(initiator, 'initiator')
  const executionId = randomUUID()
  const cancellation = seed.cancellation
    ? AbortSignal.any([seed.cancellation, runtimeCancellation])
    : runtimeCancellation
  const trace = seed.trace ?? {}
  const context: ExecutionContext = {
    executionId,
    correlationId: seed.correlationId ?? executionId,
    ...(seed.causationId ? { causationId: seed.causationId } : {}),
    actor: freezeActor(seed.actor),
    initiator: freezeActor(initiator),
    delegation: Object.freeze((seed.delegation ?? []).map((hop) => Object.freeze({
      ...hop,
      from: freezeActor(hop.from),
      to: freezeActor(hop.to),
    }))),
    ...(seed.tenant ? { tenant: Object.freeze({ ...seed.tenant }) } : {}),
    authentication: Object.freeze(seed.authentication
      ? {
          ...seed.authentication,
          ...(seed.authentication.constraints
            ? { constraints: Object.freeze([...seed.authentication.constraints]) }
            : {}),
        }
      : seed.actor.kind === 'anonymous'
        ? { state: 'anonymous' as const }
        : { state: 'authenticated' as const }),
    transport: Object.freeze({ ...seed.transport }),
    trace: Object.freeze({
      traceId: trace.traceId ?? randomBytes(16).toString('hex'),
      spanId: randomBytes(8).toString('hex'),
      traceFlags: trace.traceFlags ?? 1,
    }),
    ...(seed.locale ? { locale: seed.locale } : {}),
    ...(seed.timeZone ? { timeZone: seed.timeZone } : {}),
    ...(seed.deadline ? { deadline: new Date(seed.deadline) } : {}),
    cancellation,
  }
  return Object.freeze(context)
}

function telemetryAttributes(context: ExecutionContext): Readonly<Record<string, import('@canopy/core').JsonValue>> {
  return Object.freeze({
    executionId: context.executionId,
    correlationId: context.correlationId,
    ...(context.causationId ? { causationId: context.causationId } : {}),
    actorKind: context.actor.kind,
    ...(context.actor.id ? { actorId: context.actor.id } : {}),
    ...(context.tenant ? { tenantId: context.tenant.id } : {}),
    ...(context.tenant ? { tenantId: context.tenant.id } : {}),
    transport: context.transport.kind,
    ...(context.transport.name ? { transportName: context.transport.name } : {}),
    traceId: context.trace.traceId!,
    spanId: context.trace.spanId!,
  })
}

function logContext(context: ExecutionContext): import('@canopy/core').LogContext {
  return Object.freeze({
    executionId: context.executionId,
    correlationId: context.correlationId,
    ...(context.causationId ? { causationId: context.causationId } : {}),
    actorKind: context.actor.kind,
    ...(context.actor.id ? { actorId: context.actor.id } : {}),
    ...(context.trace.traceId ? { traceId: context.trace.traceId } : {}),
    ...(context.trace.spanId ? { spanId: context.trace.spanId } : {}),
    transport: context.transport.kind,
  })
}

function logChannelForTransport(transport: ExecutionContext['transport']['kind']): string {
  if (transport === 'job' || transport === 'schedule') return transport === 'job' ? 'queue' : 'schedule'
  return transport
}

function logChannelForSubsystem(subsystem: string): string {
  if (subsystem.startsWith('persistence.')) return 'db'
  if (subsystem.startsWith('queue.')) return 'queue'
  if (subsystem.startsWith('auth.')) return 'auth'
  if (subsystem.startsWith('signal.')) return 'signal'
  if (subsystem.startsWith('event.')) return 'event'
  if (subsystem.startsWith('lifecycle.')) return 'lifecycle'
  return subsystem.split('.')[0] ?? 'app'
}

function humanizeSubsystem(subsystem: string): string {
  return subsystem.split('.').map((part) => part[0]?.toUpperCase() + part.slice(1)).join(' ')
}

function queueContext(context: ExecutionContext): QueueExecutionEnvelope {
  return {
    sourceExecutionId: context.executionId,
    correlationId: context.correlationId,
    ...(context.causationId ? { causationId: context.causationId } : {}),
    actor: { ...context.actor },
    initiator: { ...context.initiator },
    delegation: context.delegation.map((hop) => ({
      from: { ...hop.from },
      to: { ...hop.to },
      grantId: hop.grantId,
      reason: hop.reason,
      ...(hop.expiresAt ? { expiresAt: hop.expiresAt.toISOString() } : {}),
    })),
    ...(context.tenant ? { tenant: { ...context.tenant } } : {}),
    authentication: {
      state: context.authentication.state,
      ...(context.authentication.identityId
        ? { identityId: context.authentication.identityId }
        : {}),
      ...(context.authentication.method ? { method: context.authentication.method } : {}),
      ...(context.authentication.assurance
        ? { assurance: context.authentication.assurance }
        : {}),
      ...(context.authentication.authenticatedAt
        ? { authenticatedAt: context.authentication.authenticatedAt.toISOString() }
        : {}),
      ...(context.authentication.credentialId
        ? { credentialId: context.authentication.credentialId }
        : {}),
      ...(context.authentication.constraints
        ? { constraints: [...context.authentication.constraints] }
        : {}),
    },
    trace: { ...context.trace },
    ...(context.locale ? { locale: context.locale } : {}),
    ...(context.timeZone ? { timeZone: context.timeZone } : {}),
  }
}

function queueSeed(envelope: QueueEnvelope): ExecutionContextSeed {
  const context = envelope.context
  return {
    correlationId: context.correlationId,
    causationId: envelope.scheduleId ?? envelope.id,
    actor: { ...context.actor },
    initiator: { ...context.initiator },
    delegation: context.delegation.map((hop) => ({
      from: { ...hop.from },
      to: { ...hop.to },
      grantId: hop.grantId,
      reason: hop.reason,
      ...(hop.expiresAt ? { expiresAt: new Date(hop.expiresAt) } : {}),
    })),
    ...(context.tenant ? { tenant: { ...context.tenant } } : {}),
    authentication: {
      state: context.authentication.state,
      ...(context.authentication.identityId
        ? { identityId: context.authentication.identityId }
        : {}),
      ...(context.authentication.method ? { method: context.authentication.method } : {}),
      ...(context.authentication.assurance
        ? { assurance: context.authentication.assurance }
        : {}),
      ...(context.authentication.authenticatedAt
        ? { authenticatedAt: new Date(context.authentication.authenticatedAt) }
        : {}),
      ...(context.authentication.credentialId
        ? { credentialId: context.authentication.credentialId }
        : {}),
      ...(context.authentication.constraints
        ? { constraints: [...context.authentication.constraints] }
        : {}),
    },
    transport: { kind: envelope.scheduleId ? 'schedule' : 'job', name: envelope.targetId },
    trace: { ...context.trace },
    ...(context.locale ? { locale: context.locale } : {}),
    ...(context.timeZone ? { timeZone: context.timeZone } : {}),
  }
}

function serializeQueuePayload(value: unknown): import('@canopy/core').JsonValue {
  try {
    const serialized = JSON.stringify(value)
    if (serialized === undefined) throw new Error('value has no JSON representation')
    return JSON.parse(serialized) as import('@canopy/core').JsonValue
  } catch (cause) {
    throw new OperationDispatchError('Queued payloads must be JSON serializable.', { cause })
  }
}

function deterministicJobId(targetId: string, idempotencyKey: string): string {
  const hex = createHash('sha256')
    .update(targetId)
    .update('\0')
    .update(idempotencyKey)
    .digest('hex')
    .slice(0, 32)
    .split('')
  hex[12] = '5'
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16)
  const value = hex.join('')
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`
}

function freezeActor(actor: ActorRef): ActorRef {
  return Object.freeze({ ...actor })
}

function validateActor(actor: ActorRef, label: string): void {
  if (actor.kind === 'anonymous' && actor.id !== undefined) {
    throw new ExecutionAdmissionError(`Anonymous ${label} must not have an ID.`)
  }
  if (actor.kind !== 'anonymous' && !actor.id) {
    throw new ExecutionAdmissionError(`${label} kind ${actor.kind} requires an opaque ID.`)
  }
}

async function unwindStartup(
  started: readonly LifecycleParticipant[],
  deadlines: LifecycleDeadlines,
): Promise<readonly unknown[]> {
  const reverse = [...started].reverse()
  const errors: unknown[] = []
  await invokePhase(reverse, 'stop', deadlines.stop, errors)
  await invokePhase(reverse, 'dispose', deadlines.dispose, errors)
  return errors
}

async function invokePhase(
  participants: readonly LifecycleParticipant[],
  phase: 'drain' | 'stop' | 'dispose',
  timeout: number,
  errors: unknown[],
): Promise<void> {
  for (const participant of participants) {
    if (!participant.manifest.lifecycle[phase]) continue
    try {
      await invokeLifecycle(participant, phase, timeout)
    } catch (error) {
      errors.push(error)
    }
  }
}

async function invokeLifecycle(
  participant: LifecycleParticipant,
  phase: 'start' | 'drain' | 'stop' | 'dispose',
  timeout: number,
): Promise<void> {
  const method = (participant.instance as Record<string, unknown>)[phase]
  if (typeof method !== 'function') {
    throw new RuntimeIntegrityError(`${participant.manifest.id} declares ${phase} but has no callable method.`)
  }
  const controller = new AbortController()
  const deadline = new Date(Date.now() + timeout)
  const context: LifecycleContext = { signal: controller.signal, deadline }
  let timer: NodeJS.Timeout | undefined
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new Error(`${participant.manifest.id} exceeded its ${phase} deadline of ${timeout}ms.`))
    }, timeout)
    timer.unref()
  })
  try {
    await Promise.race([
      Promise.resolve(method.call(participant.instance, context)),
      timeoutPromise,
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function loadDotenv(dotenvPath: string): Promise<Readonly<Record<string, string>>> {
  let contents: string
  try {
    contents = await readFile(dotenvPath, 'utf8')
  } catch (error) {
    if (isMissingFile(error)) return {}
    throw error
  }
  const values: Record<string, string> = {}
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.length === 0 || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator < 1) continue
    const key = line.slice(0, separator).trim()
    let value = line.slice(separator + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    values[key] = value
  }
  return values
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && (error as { code?: unknown }).code === 'ENOENT'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function constraintAllows(constraint: string, ability: string): boolean {
  if (constraint === '*' || constraint === ability) return true
  return constraint.endsWith('.*') && ability.startsWith(constraint.slice(0, -1))
}
