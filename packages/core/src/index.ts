export type Class<T = object> = abstract new (...args: never[]) => T

export {
  BroadcastTransport,
  Channel,
  FakeBroadcastTransport,
  PresenceChannel,
  PrivateChannel,
  validateBroadcastChannelName,
  type BroadcastChannelKind,
  type BroadcastConnectionAdmission,
  type BroadcastDestination,
  type BroadcastGateway,
  type BroadcastMessage,
  type BroadcastSubscriptionAdmission,
  type BroadcastSubscriptionResource,
  type ShouldBroadcast,
  type ShouldBroadcastNow,
} from './broadcasting.js'

export {
  allow,
  Authorization,
  AuthorizationError,
  deny,
  Policy,
  type PolicyDecision,
  type PolicyRequest,
} from './authorization.js'

export { Signal, SignalDispatchError, SignalHandler } from './signal.js'
export { Cache, MemoryCache, type CachePutOptions } from './cache.js'
export { Command } from './command.js'
export { MemoryTelemetry, NoopTelemetry, Telemetry, type TelemetryRecord } from './telemetry.js'
export {
  MemoryObservationRecorder,
  NoopObservationRecorder,
  ObservationRecorder,
  sanitizeObservationAttributes,
  sanitizeObservationError,
  type Observation,
  type ObservationContext,
  type ObservationError,
  type ObservationKind,
  type ObservationPhase,
} from './observation.js'
export {
  ConsoleLogSink,
  formatPrettyLog,
  Logger,
  LogSink,
  MemoryLogSink,
  NoopLogSink,
  type ConsoleLogSinkOptions,
  type LogContext,
  type LogDestination,
  type LogError,
  type LogFormat,
  type LogLevel,
  type LogRecord,
  type LoggerOptions,
} from './logging.js'
export {
  DeliveryError,
  DeliveryLedger,
  FakeMailTransport,
  FakeSmsTransport,
  MailTransport,
  Mailer,
  Sms,
  SmsTransport,
  type DeliveryAcceptance,
  type DeliveryFailureKind,
  type DeliveryState,
  type DeliveryUpdate,
  type DeliveryTransition,
  type MailMessage,
  type SmsMessage,
  type StagedDelivery,
} from './communications.js'

export {
  Auth,
  type AuthAccessToken,
  type AuthAccessTokenGrant,
  type AuthChallengeGrant,
  type AuthIdentity,
  type AuthRequestMetadata,
  type AuthSession,
  type AuthSessionGrant,
  type AuthStorageDescription,
  AuthenticationError,
  AuthenticationRateLimitError,
  isRecentPasswordAuthentication,
  type IssueAccessTokenInput,
  type LoginInput,
  type RegistrationInput,
  type ResolvedHttpAuthentication,
} from './auth.js'

import type { Event, Listener } from './event.js'
import type { Policy } from './authorization.js'
import type { Signal, SignalHandler } from './signal.js'
import type { Route } from './http.js'
import type { Job, Schedule } from './queue.js'
import type { Observer } from './observer.js'
import type { Command } from './command.js'
import type { DeliveryTransition, StagedDelivery } from './communications.js'
import { DoxaRole } from './role.js'
import type { ModelQueryPlan, ModelQueryValue } from './model-query.js'

export { DoxaRole, RoleInjectionError, type RoleInjector } from './role.js'
export type { RoleInjectionToken } from './role-context.js'

export type ConfigurationClass<T extends Configuration = Configuration> = abstract new () => T

export type FeatureClass<T extends Feature = Feature> = abstract new () => T

export type DoxaPluginPackage = '@doxajs/sendgrid' | '@doxajs/theoria' | '@doxajs/twilio-sms'

export interface DoxaFrameworkConfiguration {
  readonly database?: {
    readonly applicationName?: string
  }
  readonly auth?: {
    readonly secureCookies?: boolean
    readonly trustedOrigins?: readonly string[]
  }
  readonly queue?: {
    readonly localConcurrency?: number
    readonly outboxPollingMilliseconds?: number
  }
}

/**
 * Compile-time application declaration. Doxa never constructs this class.
 */
export abstract class DoxaApplication {
  declare readonly id: string
  declare readonly features: readonly FeatureClass[]
  declare readonly configs?: readonly ConfigurationClass[]
  declare readonly plugins?: readonly DoxaPluginPackage[]
  declare readonly framework?: DoxaFrameworkConfiguration
}

/**
 * Compile-time feature declaration. Doxa never constructs this class.
 */
export abstract class Feature {
  declare readonly id: string
  declare readonly configs?: readonly ConfigurationClass[]
  declare readonly providers?: readonly Class[]
  declare readonly actions?: readonly ActionClass[]
  declare readonly queries?: readonly QueryClass[]
  declare readonly models?: readonly Class<Model>[]
  declare readonly observers?: readonly Class<Observer>[]
  declare readonly routes?: readonly Class<Route>[]
  declare readonly events?: readonly Class<Event<unknown>>[]
  declare readonly listeners?: readonly Class<Listener<any>>[]
  declare readonly jobs?: readonly Class<Job>[]
  declare readonly schedules?: readonly Class<Schedule>[]
  declare readonly policies?: readonly Class<Policy>[]
  declare readonly signals?: readonly Class<Signal<unknown>>[]
  declare readonly signalHandlers?: readonly Class<SignalHandler<any>>[]
  declare readonly commands?: readonly Class<Command>[]
}

export {
  CurrentJob,
  type CurrentJobContext,
  Job,
  type JobConstructor,
  type JobDispatchOptions,
  JobDispatchError,
  type QueueDelivery,
  type QueueDeliveryHandler,
  type QueueEnvelope,
  type QueueExecutionEnvelope,
  type QueueJobRecord,
  QueueManager,
  type QueuePolicy,
  type QueueRuntimeRoles,
  Schedule,
  type ScheduleDefinition,
  type ScheduleMisfirePolicy,
  type ScheduleOverlapPolicy,
} from './queue.js'

export {
  DomainEvent,
  Event,
  EventDispatchError,
  Listener,
  type ShouldDispatchAfterCommit,
  type ShouldHandleEventsAfterCommit,
  type ShouldQueue,
  type ShouldQueueAfterCommit,
} from './event.js'

export {
  Http,
  HttpError,
  httpFailure,
  httpSuccess,
  type HttpEnvelope,
  type HttpEngine,
  type HttpFailure,
  type HttpMethod,
  HttpRequest,
  type HttpSuccess,
  type HttpValidationIssue,
  HttpValidationError,
  Route,
  type StandardSchema,
  type StandardSchemaIssue,
} from './http.js'

export {
  DetachedModelError,
  Model,
  ModelNotFoundError,
  ModelNotRegisteredError,
  StaleModelError,
  type ModelAttributes,
  type ModelChanges,
  type ModelConstructor,
  type ModelJournalFact,
  type ModelOutboxMessage,
  type ModelQueryDiagnostic,
  type ModelRelations,
} from './model.js'
export {
  applyModelQueryPlan,
  InvalidModelCursorError,
  MODEL_QUERY_MAX_PAGE_SIZE,
  ModelQuery,
  ModelQueryError,
  validateModelQueryPlan,
  type ModelCursorPage,
  type ModelEagerLoadConstraints,
  type ModelPage,
  type ModelQueryConstraint,
  type ModelQueryDirection,
  type ModelQueryOperator,
  type ModelQueryOrder,
  type ModelQueryPlan,
  type ModelQueryPredicate,
  type ModelQueryValue,
  type ModelRelationPath,
} from './model-query.js'
export {
  belongsTo,
  belongsToMany,
  hasMany,
  hasOne,
  type ModelRelationship,
} from './model-relation.js'
export { Observer, type ModelObserverDispatcher, type ModelObserverPhase } from './observer.js'
import type { Model, ModelAttributes, ModelConstructor } from './model.js'

/**
 * Typed configuration declaration. Doxa materializes instances without invoking constructors
 * or property initializers.
 */
export abstract class Configuration {}

export class SecretString {
  #value: string

  private constructor(value: string) {
    this.#value = value
    Object.freeze(this)
  }

  static from(value: string): SecretString {
    return new SecretString(value)
  }

  reveal(): string {
    return this.#value
  }

  toString(): string {
    return '[REDACTED]'
  }

  toJSON(): string {
    return '[REDACTED]'
  }

  [Symbol.toPrimitive](): string {
    return '[REDACTED]'
  }
}

export abstract class Action<Input = void, Output = void> extends DoxaRole {
  static readonly access: string = ''
  abstract handle(input: Input): Output | Promise<Output>
}

export abstract class Query<Input = void, Output = void> extends DoxaRole {
  static readonly access: string = ''
  abstract handle(input: Input): Output | Promise<Output>
}

export type ActionClass<Input = unknown, Output = unknown> = abstract new (
  ...dependencies: never[]
) => Action<Input, Output>

export type QueryClass<Input = unknown, Output = unknown> = abstract new (
  ...dependencies: never[]
) => Query<Input, Output>

export abstract class ActionBus {
  abstract execute<Input, Output>(
    action: ActionClass<Input, Output>,
    input: Input,
  ): Promise<Awaited<Output>>
}

export abstract class QueryBus {
  abstract execute<Input, Output>(
    query: QueryClass<Input, Output>,
    input: Input,
  ): Promise<Awaited<Output>>
}

/** Compiler-recognized capability for a service cached once per admitted execution. */
export interface ExecutionScoped {}

export type ActorKind = 'anonymous' | 'user' | 'service' | 'system'

export interface ActorRef {
  readonly kind: ActorKind
  readonly id?: string
}

export interface DelegationHop {
  readonly from: ActorRef
  readonly to: ActorRef
  readonly grantId: string
  readonly reason: string
  readonly expiresAt?: Date
}

export interface TenantRef {
  readonly id: string
}

export interface AuthenticationContext {
  readonly state: 'anonymous' | 'authenticated'
  readonly identityId?: string
  readonly method?: string
  readonly assurance?: 'single-factor' | 'multi-factor' | 'phishing-resistant'
  readonly authenticatedAt?: Date
  readonly sessionId?: string
  readonly credentialId?: string
  readonly constraints?: readonly string[]
}

export interface TransportContext {
  readonly kind: 'http' | 'job' | 'schedule' | 'console' | 'websocket' | 'test' | 'internal'
  readonly name?: string
}

export interface TraceContext {
  readonly traceId?: string
  readonly spanId?: string
  readonly traceFlags?: number
}

export interface ExecutionContext {
  readonly executionId: string
  readonly sourceExecutionId?: string
  readonly correlationId: string
  readonly causationId?: string
  readonly actor: ActorRef
  readonly initiator: ActorRef
  readonly delegation: readonly DelegationHop[]
  readonly tenant?: TenantRef
  readonly authentication: AuthenticationContext
  readonly transport: TransportContext
  readonly trace: TraceContext
  readonly locale?: string
  readonly timeZone?: string
  readonly deadline?: Date
  readonly cancellation: AbortSignal
}

export interface ExecutionContextSeed {
  readonly sourceExecutionId?: string
  readonly correlationId?: string
  readonly causationId?: string
  readonly actor: ActorRef
  readonly initiator?: ActorRef
  readonly delegation?: readonly DelegationHop[]
  readonly tenant?: TenantRef
  readonly authentication?: AuthenticationContext
  readonly transport: TransportContext
  readonly trace?: TraceContext
  readonly locale?: string
  readonly timeZone?: string
  readonly deadline?: Date
  readonly cancellation?: AbortSignal
}

export type OperationMode = 'action' | 'job' | 'query' | undefined

/** The immutable context and mutation guard for the currently admitted execution. */
export abstract class CurrentExecution {
  abstract get context(): ExecutionContext
  abstract get mode(): OperationMode
  abstract assertWritable(): void
}

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue }

export interface PersistedEntity<State extends JsonValue = JsonValue> {
  readonly type: string
  readonly id: string
  readonly version: number
  readonly state: State
}

export interface TableModelTimestamps {
  readonly createdAt: string
  readonly updatedAt: string
}

export type ModelStorage =
  | { readonly kind: 'entity-state' }
  | {
      readonly kind: 'table'
      readonly table: string
      readonly primaryKey: string
      readonly columns: Readonly<Record<string, string>>
      readonly versionColumn?: string
      readonly timestamps: false | TableModelTimestamps
    }

export interface SaveEntity<State extends JsonValue = JsonValue> {
  readonly type: string
  readonly id: string
  readonly expectedVersion?: number
  readonly state: State
  readonly storage?: ModelStorage
}

export interface JournalFact<Payload extends JsonValue = JsonValue> {
  readonly type: string
  readonly version?: number
  readonly entityType: string
  readonly entityId: string
  readonly payload: Payload
}

export interface OutboxMessage<Payload extends JsonValue = JsonValue> {
  readonly type: string
  readonly payload: Payload
  readonly availableAt?: Date
}

/** Read-only persistence boundary used by model queries in every execution mode. */
export abstract class ModelReader {
  abstract findEntity<State extends JsonValue = JsonValue>(
    type: string,
    id: string,
    storage?: ModelStorage,
  ): Promise<PersistedEntity<State> | undefined>

  abstract queryEntities<State extends JsonValue = JsonValue>(
    type: string,
    storage: ModelStorage,
    plan: ModelQueryPlan,
  ): Promise<readonly PersistedEntity<State>[]>

  abstract aggregateEntities(
    type: string,
    storage: ModelStorage,
    plan: ModelQueryPlan,
    operation: 'count' | 'min' | 'max' | 'sum' | 'average',
    attribute?: string,
  ): Promise<number | ModelQueryValue | undefined>
}

/** Writable transaction boundary; actions and jobs also use it as their model reader. */
export abstract class UnitOfWork extends ModelReader {
  abstract saveEntity<State extends JsonValue>(entity: SaveEntity<State>): Promise<number>
  abstract deleteEntity(
    type: string,
    id: string,
    expectedVersion: number,
    storage?: ModelStorage,
  ): Promise<void>
  abstract record<Payload extends JsonValue>(fact: JournalFact<Payload>): Promise<string>
  abstract enqueue<Payload extends JsonValue>(message: OutboxMessage<Payload>): Promise<string>
  abstract stageDelivery(delivery: StagedDelivery): Promise<void>
  abstract transitionDelivery(transition: DeliveryTransition): Promise<void>
  abstract afterCommit(callback: () => void | Promise<void>): void
}

export class PersistenceError extends Error {
  override readonly name: string = 'PersistenceError'
}

export class OptimisticConcurrencyError extends PersistenceError {
  override readonly name = 'OptimisticConcurrencyError'

  constructor(
    readonly entityType: string,
    readonly entityId: string,
    readonly expectedVersion: number | undefined,
  ) {
    super(
      `Entity ${entityType}/${entityId} does not match expected version ${String(expectedVersion)}.`,
    )
  }
}

export class ReadOnlyExecutionError extends PersistenceError {
  override readonly name = 'ReadOnlyExecutionError'
}

export class StaleUnitOfWorkError extends PersistenceError {
  override readonly name = 'StaleUnitOfWorkError'
}

export class AfterCommitError extends PersistenceError {
  override readonly name = 'AfterCommitError'

  constructor(readonly errors: readonly unknown[]) {
    super(
      `After-commit processing failed ${errors.length} time(s) after durability was established.`,
    )
  }
}

/** Infrastructure boundary used by the runtime for every action transaction. */
export abstract class TransactionManager {
  abstract read<Output>(
    context: ExecutionContext,
    work: (reader: ModelReader) => Promise<Output>,
  ): Promise<Output>

  abstract transaction<Output>(
    context: ExecutionContext,
    work: (unitOfWork: UnitOfWork) => Promise<Output>,
  ): Promise<Output>
}

export interface LifecycleContext {
  readonly signal: AbortSignal
  readonly deadline: Date
}

export interface Starts {
  start(context: LifecycleContext): void | Promise<void>
}

export interface Drains {
  drain(context: LifecycleContext): void | Promise<void>
}

export interface Stops {
  stop(context: LifecycleContext): void | Promise<void>
}

export interface Disposes {
  dispose(context: LifecycleContext): void | Promise<void>
}
