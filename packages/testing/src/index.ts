import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import {
  Auth,
  type AuthAccessToken,
  type AuthAccessTokenGrant,
  type AuthChallengeGrant,
  type AuthIdentity,
  type AuthRequestMetadata,
  type AuthSessionGrant,
  type AuthSession,
  type ActorRef,
  type AuthenticationContext,
  type ActionClass,
  type DoxaApplication,
  type DeliveryTransition,
  type ExecutionContext,
  Event,
  FakeMailTransport,
  FakeSmsTransport,
  type IssueAccessTokenInput,
  type JournalFact,
  Job,
  type JobConstructor,
  type JobDispatchOptions,
  type JsonValue,
  type LoginInput,
  MemoryCache,
  MemoryLogSink,
  MemoryObservationRecorder,
  MemoryTelemetry,
  type OutboxMessage,
  type PersistedEntity,
  type PolicyDecision,
  type QueryClass,
  type QueueDeliveryHandler,
  type QueueEnvelope,
  type QueueJobRecord,
  QueueManager,
  type RegistrationInput,
  type ResolvedHttpAuthentication,
  type ScheduleDefinition,
  type SaveEntity,
  SecretString,
  Signal,
  type StagedDelivery,
  TransactionManager,
  UnitOfWork,
} from '@doxajs/core'
import { HonoHttpEngine } from '@doxajs/http-hono'
import { Doxa, type BootOptions, type DoxaRuntime } from '@doxajs/runtime'

export {
  FakeMailTransport,
  FakeSmsTransport,
  MemoryCache,
  MemoryLogSink,
  MemoryObservationRecorder,
  MemoryTelemetry,
}

export class TestObservationRecorder extends MemoryObservationRecorder {
  start(): void {}
  drain(): void {}
  dispose(): void {}
}

export class DoxaTestHarness {
  readonly http: HonoHttpEngine
  readonly logs: MemoryLogSink
  #actor: ActorRef = { kind: 'anonymous' }
  #authentication: AuthenticationContext = { state: 'anonymous' }

  private constructor(
    readonly runtime: DoxaRuntime,
    logs: MemoryLogSink,
    readonly auth?: TestAuth,
    readonly observations?: TestObservationRecorder,
  ) {
    this.http = new HonoHttpEngine(runtime)
    this.logs = logs
  }

  static async boot(
    application: abstract new () => DoxaApplication,
    options: BootOptions & { readonly authProviderId?: string } = {},
  ): Promise<DoxaTestHarness> {
    const auth = options.authProviderId ? new TestAuth() : undefined
    const observation = await testObservationOverride(options.artifactsDirectory)
    const overrides = {
      ...(observation && !(observation.providerId in (options.providerOverrides ?? {}))
        ? { [observation.providerId]: observation.recorder }
        : {}),
      ...options.providerOverrides,
      ...(auth && options.authProviderId ? { [options.authProviderId]: auth } : {}),
    }
    const logs = new MemoryLogSink()
    const logging =
      options.logging === false
        ? (false as const)
        : { level: 'debug' as const, ...options.logging, sink: logs }
    const runtime = await Doxa.boot(application, {
      ...options,
      providerOverrides: overrides,
      logging,
    })
    return new DoxaTestHarness(runtime, logs, auth, observation?.recorder)
  }

  actingAs(actor: ActorRef, authentication?: AuthenticationContext): this {
    this.#actor = Object.freeze({ ...actor })
    this.#authentication = Object.freeze(authentication ?? authenticationFor(actor))
    this.auth?.actingAs(this.#actor, this.#authentication)
    return this
  }

  actingAsUser(id: string = randomUUID()): this {
    return this.actingAs({ kind: 'user', id })
  }
  actingAsSystem(id: string = 'doxa:test'): this {
    return this.actingAs({ kind: 'system', id })
  }
  asAnonymous(): this {
    return this.actingAs({ kind: 'anonymous' })
  }

  action<Input, Output>(
    action: ActionClass<Input, Output>,
    input: Input,
  ): Promise<Awaited<Output>> {
    return this.admit(() => this.runtime.actions.execute(action, input), 'test:action')
  }

  query<Input, Output>(query: QueryClass<Input, Output>, input: Input): Promise<Awaited<Output>> {
    return this.admit(() => this.runtime.queries.execute(query, input), 'test:query')
  }

  event<Arguments extends readonly unknown[], Instance extends Event<unknown>>(
    event: (new (...arguments_: Arguments) => Instance) & {
      readonly id: string
      dispatch(...arguments_: Arguments): Promise<void>
    },
    ...arguments_: Arguments
  ): Promise<void> {
    return this.admit(() => event.dispatch(...arguments_), `test:event:${event.id}`)
  }

  signal<Arguments extends readonly unknown[], Instance extends Signal<unknown>>(
    signal: (new (...arguments_: Arguments) => Instance) & {
      readonly id: string
      dispatch(...arguments_: Arguments): Promise<void>
    },
    ...arguments_: Arguments
  ): Promise<void> {
    return this.admit(() => signal.dispatch(...arguments_), `test:signal:${signal.id}`)
  }

  job<Input, Instance extends Job<Input>>(
    job: JobConstructor<Instance, Input> & {
      dispatch(input: Input, options?: JobDispatchOptions): Promise<string>
    },
    input: Input,
    options?: JobDispatchOptions,
  ): Promise<string> {
    return this.admit(() => job.dispatch(input, options), `test:job:${job.id}`)
  }

  command(name: string, arguments_: readonly string[] = []): Promise<void> {
    return this.admit(() => this.runtime.dispatchCommand(name, arguments_), `test:command:${name}`)
  }

  request(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    const request = input instanceof Request ? input : new Request(input, init)
    return this.http.fetch(request)
  }

  shutdown(): Promise<void> {
    return this.runtime.shutdown()
  }

  private admit<Output>(work: () => Promise<Output>, name: string): Promise<Output> {
    return this.runtime.admit(
      {
        actor: this.#actor,
        authentication: this.#authentication,
        transport: { kind: 'test', name },
      },
      work,
    )
  }
}

async function testObservationOverride(
  artifactsDirectory: string | undefined,
): Promise<
  { readonly providerId: string; readonly recorder: TestObservationRecorder } | undefined
> {
  const manifestPath = path.join(path.resolve(artifactsDirectory ?? '.doxa'), 'manifest.json')
  try {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      providers?: Array<{ id: string; capabilities?: readonly string[] }>
    }
    const provider = manifest.providers?.find((entry) =>
      entry.capabilities?.includes('observations'),
    )
    return provider
      ? { providerId: provider.id, recorder: new TestObservationRecorder() }
      : undefined
  } catch {
    return undefined
  }
}

export class TestAuth extends Auth {
  readonly authorizationDecisions: Array<{ ability: string; decision: PolicyDecision }> = []
  readonly #identities = new Map<string, AuthIdentity>()
  readonly #sessions = new Map<string, AuthSession>()
  readonly #accessTokens = new Map<string, AuthAccessToken>()
  #resolved: ResolvedHttpAuthentication = {
    actor: { kind: 'anonymous' },
    authentication: { state: 'anonymous' },
  }

  actingAs(actor: ActorRef, authentication?: AuthenticationContext): void {
    if (actor.kind === 'user' && actor.id && !this.#identities.has(actor.id)) {
      this.#identities.set(actor.id, {
        id: actor.id,
        email: `${actor.id}@doxajs.test`,
        emailVerified: true,
        createdAt: new Date(),
      })
    }
    this.#resolved = {
      actor: { ...actor },
      authentication: authentication ?? authenticationFor(actor),
    }
  }
  async register(input: RegistrationInput): Promise<AuthIdentity> {
    const identity = {
      id: randomUUID(),
      email: input.email.toLowerCase(),
      emailVerified: true,
      createdAt: new Date(),
    }
    this.#identities.set(identity.id, identity)
    return identity
  }
  async findIdentity(id: string): Promise<AuthIdentity | undefined> {
    return this.#identities.get(id)
  }
  async login(input: LoginInput, _metadata?: AuthRequestMetadata): Promise<AuthSessionGrant> {
    const identity =
      [...this.#identities.values()].find((value) => value.email === input.email.toLowerCase()) ??
      (await this.register({ ...input }))
    const now = new Date()
    const session = {
      id: randomUUID(),
      identityId: identity.id,
      createdAt: now,
      authenticatedAt: now,
      expiresAt: new Date(now.getTime() + 3_600_000),
    }
    this.#sessions.set(session.id, session)
    return { identity, session, token: SecretString.from(`test-session-${session.id}`) }
  }
  async issueEmailVerification(identityId: string): Promise<AuthChallengeGrant> {
    return {
      identityId,
      token: SecretString.from(`test-verify-${identityId}`),
      expiresAt: new Date(Date.now() + 3_600_000),
    }
  }
  async verifyEmail(token: string): Promise<AuthIdentity> {
    const id = token.replace(/^test-verify-/, '')
    const identity = this.#identities.get(id)
    if (!identity) throw new Error('Invalid test verification token.')
    const verified = { ...identity, emailVerified: true }
    this.#identities.set(id, verified)
    return verified
  }
  async issuePasswordReset(email: string): Promise<AuthChallengeGrant | undefined> {
    const identity = [...this.#identities.values()].find(
      (value) => value.email === email.toLowerCase(),
    )
    return identity
      ? {
          identityId: identity.id,
          token: SecretString.from(`test-reset-${identity.id}`),
          expiresAt: new Date(Date.now() + 3_600_000),
        }
      : undefined
  }
  async resetPassword(_token: string, _newPassword: string): Promise<void> {}
  async changePassword(
    _identityId: string,
    _currentPassword: string,
    _newPassword: string,
  ): Promise<void> {}
  async revokeSession(id: string): Promise<void> {
    const value = this.#sessions.get(id)
    if (value) this.#sessions.set(id, { ...value, revokedAt: new Date() })
  }
  async listSessions(id: string): Promise<readonly AuthSession[]> {
    return [...this.#sessions.values()].filter((value) => value.identityId === id)
  }
  async revokeAllSessions(id: string): Promise<number> {
    const active = [...this.#sessions.values()].filter(
      (value) => value.identityId === id && !value.revokedAt,
    )
    for (const value of active) this.#sessions.set(value.id, { ...value, revokedAt: new Date() })
    return active.length
  }
  async issueAccessToken(
    identityId: string,
    input: IssueAccessTokenInput,
  ): Promise<AuthAccessTokenGrant> {
    const now = new Date()
    const id = randomUUID()
    const accessToken = {
      id,
      identityId,
      name: input.name,
      displayPrefix: 'test',
      constraints: input.constraints ?? [],
      createdAt: now,
      expiresAt: input.expiresAt ?? new Date(now.getTime() + 3_600_000),
    }
    this.#accessTokens.set(id, accessToken)
    return { accessToken, token: SecretString.from(`test-token-${id}`) }
  }
  async listAccessTokens(id: string): Promise<readonly AuthAccessToken[]> {
    return [...this.#accessTokens.values()].filter((value) => value.identityId === id)
  }
  rotateAccessToken(identityId: string, id: string): Promise<AuthAccessTokenGrant> {
    return this.issueAccessToken(identityId, { name: id })
  }
  async revokeAccessToken(identityId: string, tokenId: string): Promise<void> {
    const value = this.#accessTokens.get(tokenId)
    if (value?.identityId === identityId)
      this.#accessTokens.set(tokenId, { ...value, revokedAt: new Date() })
  }
  isSessionRevoked(id: string): boolean {
    return Boolean(this.#sessions.get(id)?.revokedAt)
  }
  isAccessTokenRevoked(id: string): boolean {
    return Boolean(this.#accessTokens.get(id)?.revokedAt)
  }
  async recordAuthorization(
    ability: string,
    decision: PolicyDecision,
    _context: ExecutionContext,
  ): Promise<void> {
    this.authorizationDecisions.push({ ability, decision })
  }
  async resolveHttp(_request: Request): Promise<ResolvedHttpAuthentication> {
    return this.#resolved
  }
  sessionCookie(grant: AuthSessionGrant): string {
    return `doxa_session=${grant.token.reveal()}; HttpOnly; SameSite=Lax; Path=/`
  }
  expiredSessionCookie(): string {
    return 'doxa_session=; Max-Age=0; HttpOnly; SameSite=Lax; Path=/'
  }
}

export class FakeQueueManager extends QueueManager {
  readonly queued: QueueEnvelope[] = []
  readonly schedules = new Map<string, ScheduleDefinition>()
  #handler?: QueueDeliveryHandler
  bind(handler: QueueDeliveryHandler): void {
    this.#handler = handler
  }
  reconcileSchedules(schedules: readonly ScheduleDefinition[]): void {
    this.schedules.clear()
    for (const schedule of schedules) this.schedules.set(schedule.id, structuredClone(schedule))
  }
  async enqueue(envelope: QueueEnvelope): Promise<string> {
    this.queued.push(structuredClone(envelope))
    return envelope.id
  }
  async flushOutbox(): Promise<number> {
    return 0
  }
  async findJob(id: string): Promise<QueueJobRecord | undefined> {
    return this.queued.some((job) => job.id === id)
      ? { id, state: 'created', retryCount: 0, retryLimit: 0 }
      : undefined
  }
  async runNext(attempt = 1): Promise<void> {
    const envelope = this.queued.shift()
    if (!envelope) throw new Error('No fake queue delivery is pending.')
    if (!this.#handler) throw new Error('Fake queue is not bound to a Doxa runtime.')
    await this.#handler({ envelope, attempt, cancellation: new AbortController().signal })
  }
  async runSchedule(id: string, attempt = 1): Promise<void> {
    const schedule = this.schedules.get(id)
    if (!schedule) throw new Error(`No fake schedule is declared with ID ${id}.`)
    if (!this.#handler) throw new Error('Fake queue is not bound to a Doxa runtime.')
    const envelopeId = randomUUID()
    await this.#handler({
      envelope: {
        id: envelopeId,
        kind: 'job',
        targetId: schedule.targetId,
        scheduleId: schedule.id,
        payload: schedule.input,
        policy: schedule.policy,
        context: {
          sourceExecutionId: envelopeId,
          correlationId: envelopeId,
          causationId: schedule.id,
          actor: { kind: 'system', id: 'doxa:test-scheduler' },
          initiator: { kind: 'system', id: 'doxa:test-scheduler' },
          delegation: [],
          authentication: {
            state: 'authenticated',
            identityId: 'doxa:test-scheduler',
            method: 'schedule',
          },
          trace: {},
          timeZone: schedule.timeZone,
        },
      },
      attempt,
      cancellation: new AbortController().signal,
    })
  }
  hasQueued(target: string | { readonly id: string }): boolean {
    const id = typeof target === 'string' ? target : target.id
    return this.queued.some(
      (envelope) => envelope.targetId === id || envelope.targetId.endsWith(`/${id}`),
    )
  }
}

interface MemoryState {
  readonly entities: Map<string, PersistedEntity>
  readonly journal: JournalFact[]
  readonly outbox: OutboxMessage[]
  readonly deliveries: Map<string, StagedDelivery & { state: string }>
}

export class MemoryTransactionManager extends TransactionManager {
  readonly state: MemoryState = {
    entities: new Map(),
    journal: [],
    outbox: [],
    deliveries: new Map(),
  }
  constructor(private readonly queue?: QueueManager) {
    super()
  }
  async transaction<Output>(
    _context: ExecutionContext,
    work: (unitOfWork: UnitOfWork) => Promise<Output>,
  ): Promise<Output> {
    const draft = cloneState(this.state)
    const outboxStart = draft.outbox.length
    const unit = new MemoryUnitOfWork(draft)
    const output = await work(unit)
    replaceState(this.state, draft)
    await unit.commit()
    if (this.queue) {
      for (const message of draft.outbox.slice(outboxStart)) {
        if (message.type === 'doxa.queue')
          await this.queue.enqueue(message.payload as unknown as QueueEnvelope)
      }
    }
    return output
  }
}

class MemoryUnitOfWork extends UnitOfWork {
  readonly #afterCommit: Array<() => void | Promise<void>> = []
  constructor(private readonly state: MemoryState) {
    super()
  }
  async findEntity<State extends JsonValue>(
    type: string,
    id: string,
  ): Promise<PersistedEntity<State> | undefined> {
    return this.state.entities.get(`${type}/${id}`) as PersistedEntity<State> | undefined
  }
  async saveEntity<State extends JsonValue>(entity: SaveEntity<State>): Promise<number> {
    const key = `${entity.type}/${entity.id}`
    const current = this.state.entities.get(key)
    if (current?.version !== entity.expectedVersion)
      throw new Error(`Optimistic concurrency conflict for ${key}.`)
    const version = (current?.version ?? 0) + 1
    this.state.entities.set(key, {
      type: entity.type,
      id: entity.id,
      version,
      state: structuredClone(entity.state),
    })
    return version
  }
  async deleteEntity(type: string, id: string, expectedVersion: number): Promise<void> {
    const key = `${type}/${id}`
    if (this.state.entities.get(key)?.version !== expectedVersion)
      throw new Error(`Optimistic concurrency conflict for ${key}.`)
    this.state.entities.delete(key)
  }
  async record<Payload extends JsonValue>(fact: JournalFact<Payload>): Promise<string> {
    this.state.journal.push(structuredClone(fact))
    return randomUUID()
  }
  async enqueue<Payload extends JsonValue>(message: OutboxMessage<Payload>): Promise<string> {
    this.state.outbox.push(structuredClone(message))
    return randomUUID()
  }
  async stageDelivery(delivery: StagedDelivery): Promise<void> {
    this.state.deliveries.set(delivery.id, { ...structuredClone(delivery), state: 'pending' })
  }
  async transitionDelivery(transition: DeliveryTransition): Promise<void> {
    const value = this.state.deliveries.get(transition.messageId)
    if (value)
      this.state.deliveries.set(transition.messageId, { ...value, state: transition.state })
  }
  afterCommit(callback: () => void | Promise<void>): void {
    this.#afterCommit.push(callback)
  }
  async commit(): Promise<void> {
    for (const callback of this.#afterCommit) await callback()
  }
}

function cloneState(state: MemoryState): MemoryState {
  return {
    entities: new Map(structuredClone([...state.entities])),
    journal: structuredClone(state.journal),
    outbox: structuredClone(state.outbox),
    deliveries: new Map(structuredClone([...state.deliveries])),
  }
}
function replaceState(target: MemoryState, source: MemoryState): void {
  target.entities.clear()
  for (const [key, value] of source.entities) target.entities.set(key, value)
  target.journal.splice(0, target.journal.length, ...source.journal)
  target.outbox.splice(0, target.outbox.length, ...source.outbox)
  target.deliveries.clear()
  for (const [key, value] of source.deliveries) target.deliveries.set(key, value)
}

function authenticationFor(actor: ActorRef): AuthenticationContext {
  return actor.kind === 'anonymous'
    ? { state: 'anonymous' }
    : { state: 'authenticated', ...(actor.id ? { identityId: actor.id } : {}), method: 'test' }
}
