import { randomUUID } from 'node:crypto'

import {
  AfterCommitError,
  type Disposes,
  type ExecutionContext,
  type JournalFact,
  type JsonValue,
  type LifecycleContext,
  type ModelStorage,
  OptimisticConcurrencyError,
  type OutboxMessage,
  PersistenceError,
  type PersistedEntity,
  type SaveEntity,
  type StagedDelivery,
  type DeliveryTransition,
  StaleUnitOfWorkError,
  type Starts,
  TransactionManager,
  UnitOfWork,
} from '@canopy/core'
import { and, eq, sql, type SQL } from 'drizzle-orm'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

import {
  entityStates,
  journalEntries,
  outboxMessages,
  deliveryMessages,
  deliveryEvents,
  persistenceSchema,
  type DurableExecutionEnvelope,
} from './schema.js'

export interface PostgresTransactionOptions {
  readonly connectionString: string
  readonly maximumConnections?: number
  readonly applicationName?: string
}

type Database = NodePgDatabase<typeof persistenceSchema>
type DatabaseSession = Pick<Database, 'select' | 'insert' | 'update' | 'delete' | 'execute'>

export class PostgresTransactionManager
  extends TransactionManager
  implements Starts, Disposes
{
  #pool: Pool | undefined
  #database: Database | undefined
  #connectionString: string
  #maximumConnections: number | undefined
  #applicationName: string | undefined

  constructor(options: PostgresTransactionOptions) {
    super()
    this.#connectionString = options.connectionString
    this.#maximumConnections = options.maximumConnections
    this.#applicationName = options.applicationName
  }

  async start(context: LifecycleContext): Promise<void> {
    if (context.signal.aborted) throw context.signal.reason
    const pool = new Pool({
      connectionString: this.#connectionString,
      ...(this.#maximumConnections
        ? { max: this.#maximumConnections }
        : {}),
      ...(this.#applicationName
        ? { application_name: this.#applicationName }
        : {}),
    })
    try {
      await pool.query('select 1')
      this.#pool = pool
      this.#database = drizzle(pool, { schema: persistenceSchema })
    } catch (error) {
      await pool.end().catch(() => undefined)
      throw translatePersistenceError(error)
    }
  }

  async transaction<Output>(
    context: ExecutionContext,
    work: (unitOfWork: UnitOfWork) => Promise<Output>,
  ): Promise<Output> {
    const database = this.#database
    if (!database) throw new PersistenceError('PostgreSQL transaction manager is not started.')
    let unitOfWork: PostgresUnitOfWork | undefined
    let result: Output
    try {
      result = await database.transaction(async (transaction) => {
        unitOfWork = new PostgresUnitOfWork(transaction, context)
        try {
          return await work(unitOfWork)
        } finally {
          unitOfWork.close()
        }
      })
    } catch (error) {
      throw translatePersistenceError(error)
    }
    await unitOfWork?.releaseAfterCommit()
    return result
  }

  async dispose(_context: LifecycleContext): Promise<void> {
    const pool = this.#pool
    this.#database = undefined
    this.#pool = undefined
    if (pool) await pool.end()
  }
}

class PostgresUnitOfWork extends UnitOfWork {
  readonly #afterCommit: Array<() => void | Promise<void>> = []
  #active = true

  constructor(
    private readonly session: DatabaseSession,
    private readonly context: ExecutionContext,
  ) {
    super()
  }

  async findEntity<State extends JsonValue>(
    type: string,
    id: string,
    storage: ModelStorage = { kind: 'entity-state' },
  ): Promise<PersistedEntity<State> | undefined> {
    this.assertActive()
    if (storage.kind === 'table') return await this.findMappedEntity(type, id, storage)
    const [row] = await this.session
      .select()
      .from(entityStates)
      .where(and(eq(entityStates.entityType, type), eq(entityStates.entityId, id)))
      .limit(1)
    if (!row) return undefined
    return {
      type: row.entityType,
      id: row.entityId,
      version: row.version,
      state: row.state as State,
    }
  }

  async saveEntity<State extends JsonValue>(entity: SaveEntity<State>): Promise<number> {
    this.assertActive()
    if (entity.storage?.kind === 'table') return await this.saveMappedEntity(entity, entity.storage)
    const now = new Date()
    if (entity.expectedVersion === undefined) {
      try {
        const [created] = await this.session.insert(entityStates).values({
          entityType: entity.type,
          entityId: entity.id,
          version: 1,
          state: entity.state,
          updatedAt: now,
        }).returning({ version: entityStates.version })
        if (!created) throw new PersistenceError('PostgreSQL did not return the inserted entity version.')
        return created.version
      } catch (error) {
        if (postgresCode(error) === '23505') {
          throw new OptimisticConcurrencyError(entity.type, entity.id, entity.expectedVersion)
        }
        throw translatePersistenceError(error)
      }
    }

    const [updated] = await this.session.update(entityStates).set({
      version: entity.expectedVersion + 1,
      state: entity.state,
      updatedAt: now,
    }).where(and(
      eq(entityStates.entityType, entity.type),
      eq(entityStates.entityId, entity.id),
      eq(entityStates.version, entity.expectedVersion),
    )).returning({ version: entityStates.version })
    if (!updated) {
      throw new OptimisticConcurrencyError(entity.type, entity.id, entity.expectedVersion)
    }
    return updated.version
  }

  async deleteEntity(type: string, id: string, expectedVersion: number, storage: ModelStorage = { kind: 'entity-state' }): Promise<void> {
    this.assertActive()
    if (storage.kind === 'table') {
      await this.deleteMappedEntity(type, id, expectedVersion, storage)
      return
    }
    const [deleted] = await this.session.delete(entityStates).where(and(
      eq(entityStates.entityType, type),
      eq(entityStates.entityId, id),
      eq(entityStates.version, expectedVersion),
    )).returning({ id: entityStates.entityId })
    if (!deleted) throw new OptimisticConcurrencyError(type, id, expectedVersion)
  }

  private async findMappedEntity<State extends JsonValue>(
    type: string,
    id: string,
    storage: Extract<ModelStorage, { readonly kind: 'table' }>,
  ): Promise<PersistedEntity<State> | undefined> {
    const version = versionExpression(storage)
    const result = await this.session.execute(sql`
      SELECT *, ${version} AS ${sql.identifier('__canopy_version')}
      FROM ${qualifiedIdentifier(storage.table)}
      WHERE ${sql.identifier(storage.primaryKey)} = ${id}
      LIMIT 1
    `)
    const row = result.rows[0] as Record<string, unknown> | undefined
    if (!row) return undefined
    const state = hydrateMappedState(row, storage)
    return { type, id: String(state.id), version: numberVersion(row.__canopy_version, type, id), state: state as State }
  }

  private async saveMappedEntity<State extends JsonValue>(
    entity: SaveEntity<State>,
    storage: Extract<ModelStorage, { readonly kind: 'table' }>,
  ): Promise<number> {
    if (typeof entity.state !== 'object' || entity.state === null || Array.isArray(entity.state)) {
      throw new PersistenceError(`Mapped model ${entity.type} state must be a JSON object.`)
    }
    const values = dehydrateMappedState(entity.state as Record<string, JsonValue>, storage)
    const now = new Date()
    if (storage.timestamps) {
      if (entity.expectedVersion === undefined && !values.has(storage.timestamps.createdAt)) values.set(storage.timestamps.createdAt, now)
      if (!values.has(storage.timestamps.updatedAt)) values.set(storage.timestamps.updatedAt, now)
    }
    if (storage.versionColumn) values.set(storage.versionColumn, entity.expectedVersion === undefined ? 1 : entity.expectedVersion + 1)
    if (entity.expectedVersion === undefined) {
      try {
        const columns = [...values.keys()].map((column) => sql.identifier(column))
        const parameters = [...values.values()].map((value) => sql`${value}`)
        const result = await this.session.execute(sql`
          INSERT INTO ${qualifiedIdentifier(storage.table)} (${sql.join(columns, sql`, `)})
          VALUES (${sql.join(parameters, sql`, `)})
          RETURNING ${versionExpression(storage)} AS ${sql.identifier('__canopy_version')}
        `)
        const row = result.rows[0] as Record<string, unknown> | undefined
        if (!row) throw new PersistenceError('PostgreSQL did not return the inserted mapped model version.')
        return numberVersion(row.__canopy_version, entity.type, entity.id)
      } catch (error) {
        if (postgresCode(error) === '23505') throw new OptimisticConcurrencyError(entity.type, entity.id, entity.expectedVersion)
        throw translatePersistenceError(error)
      }
    }
    values.delete(storage.primaryKey)
    const assignments = [...values.entries()].map(([column, value]) => sql`${sql.identifier(column)} = ${value}`)
    if (assignments.length === 0) return entity.expectedVersion
    const result = await this.session.execute(sql`
      UPDATE ${qualifiedIdentifier(storage.table)}
      SET ${sql.join(assignments, sql`, `)}
      WHERE ${sql.identifier(storage.primaryKey)} = ${entity.id}
        AND ${versionPredicate(storage, entity.expectedVersion)}
      RETURNING ${versionExpression(storage)} AS ${sql.identifier('__canopy_version')}
    `)
    const row = result.rows[0] as Record<string, unknown> | undefined
    if (!row) throw new OptimisticConcurrencyError(entity.type, entity.id, entity.expectedVersion)
    return numberVersion(row.__canopy_version, entity.type, entity.id)
  }

  private async deleteMappedEntity(
    type: string,
    id: string,
    expectedVersion: number,
    storage: Extract<ModelStorage, { readonly kind: 'table' }>,
  ): Promise<void> {
    const result = await this.session.execute(sql`
      DELETE FROM ${qualifiedIdentifier(storage.table)}
      WHERE ${sql.identifier(storage.primaryKey)} = ${id}
        AND ${versionPredicate(storage, expectedVersion)}
      RETURNING ${sql.identifier(storage.primaryKey)}
    `)
    if (result.rows.length === 0) throw new OptimisticConcurrencyError(type, id, expectedVersion)
  }

  async record<Payload extends JsonValue>(fact: JournalFact<Payload>): Promise<string> {
    this.assertActive()
    const id = randomUUID()
    await this.session.insert(journalEntries).values({
      id,
      factType: fact.type,
      entityType: fact.entityType,
      entityId: fact.entityId,
      payload: fact.payload,
      context: durableContext(this.context),
      occurredAt: new Date(),
    })
    return id
  }

  async enqueue<Payload extends JsonValue>(message: OutboxMessage<Payload>): Promise<string> {
    this.assertActive()
    const id = randomUUID()
    const now = new Date()
    await this.session.insert(outboxMessages).values({
      id,
      messageType: message.type,
      payload: message.payload,
      context: durableContext(this.context),
      status: 'pending',
      availableAt: message.availableAt ?? now,
      createdAt: now,
    })
    return id
  }

  async stageDelivery(delivery: StagedDelivery): Promise<void> {
    this.assertActive()
    const now = new Date()
    await this.session.insert(deliveryMessages).values({
      id: delivery.id,
      channel: delivery.channel,
      recipients: delivery.recipients,
      payload: delivery.payload,
      state: 'pending',
      context: deliveryContext(this.context),
      createdAt: now,
      updatedAt: now,
    })
  }

  async transitionDelivery(transition: DeliveryTransition): Promise<void> {
    this.assertActive()
    if (transition.eventId) {
      const inserted = await this.session.insert(deliveryEvents).values({
        eventId: transition.eventId,
        messageId: transition.messageId,
        state: transition.state,
        occurredAt: new Date(),
      }).onConflictDoNothing().returning({ eventId: deliveryEvents.eventId })
      if (inserted.length === 0) return
    }
    await this.session.update(deliveryMessages).set({
      state: transition.state,
      ...(transition.providerMessageId ? { providerMessageId: transition.providerMessageId } : {}),
      ...(transition.failureKind ? { failureKind: transition.failureKind } : {}),
      ...(transition.code ? { failureCode: transition.code } : {}),
      updatedAt: new Date(),
    }).where(eq(deliveryMessages.id, transition.messageId))
  }

  afterCommit(callback: () => void | Promise<void>): void {
    this.assertActive()
    this.#afterCommit.push(callback)
  }

  close(): void {
    this.#active = false
  }

  async releaseAfterCommit(): Promise<void> {
    const errors: unknown[] = []
    for (const callback of this.#afterCommit) {
      try {
        await callback()
      } catch (error) {
        errors.push(error)
      }
    }
    this.#afterCommit.length = 0
    if (errors.length > 0) throw new AfterCommitError(errors)
  }

  private assertActive(): void {
    if (!this.#active) throw new StaleUnitOfWorkError('Unit of Work is no longer active.')
  }
}

function qualifiedIdentifier(value: string): SQL {
  return sql.join(value.split('.').map((part) => sql.identifier(part)), sql`.`)
}

function versionExpression(storage: Extract<ModelStorage, { readonly kind: 'table' }>): SQL {
  return storage.versionColumn
    ? sql`${sql.identifier(storage.versionColumn)}`
    : sql.raw('(xmin::text)::bigint')
}

function versionPredicate(
  storage: Extract<ModelStorage, { readonly kind: 'table' }>,
  expectedVersion: number,
): SQL {
  return storage.versionColumn
    ? sql`${sql.identifier(storage.versionColumn)} = ${expectedVersion}`
    : sql`(xmin::text)::bigint = ${expectedVersion}`
}

function hydrateMappedState(
  row: Readonly<Record<string, unknown>>,
  storage: Extract<ModelStorage, { readonly kind: 'table' }>,
): Record<string, JsonValue> {
  const inverse = new Map(Object.entries(storage.columns).map(([attribute, column]) => [column, attribute]))
  const explicitlyMapped = new Set(Object.values(storage.columns))
  const infrastructure = new Set<string>([
    '__canopy_version',
    ...(storage.versionColumn && !explicitlyMapped.has(storage.versionColumn) ? [storage.versionColumn] : []),
    ...(storage.timestamps ? [storage.timestamps.createdAt, storage.timestamps.updatedAt].filter((column) => !explicitlyMapped.has(column)) : []),
  ])
  const state: Record<string, JsonValue> = {}
  for (const [column, value] of Object.entries(row)) {
    if (infrastructure.has(column)) continue
    state[inverse.get(column) ?? column] = databaseJsonValue(value)
  }
  state.id = String(row[storage.primaryKey])
  return state
}

function dehydrateMappedState(
  state: Readonly<Record<string, JsonValue>>,
  storage: Extract<ModelStorage, { readonly kind: 'table' }>,
): Map<string, unknown> {
  const values = new Map<string, unknown>()
  for (const [attribute, value] of Object.entries(state)) {
    const column = attribute === 'id' ? storage.primaryKey : storage.columns[attribute] ?? attribute
    values.set(column, value)
  }
  return values
}

function databaseJsonValue(value: unknown): JsonValue {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'bigint') return value.toString()
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.map(databaseJsonValue)
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, databaseJsonValue(nested)]))
  throw new PersistenceError(`Mapped PostgreSQL value of type ${typeof value} is not JSON-compatible.`)
}

function numberVersion(value: unknown, type: string, id: string): number {
  const version = Number(value)
  if (!Number.isSafeInteger(version) || version < 0) {
    throw new PersistenceError(`Mapped model ${type}/${id} returned an invalid optimistic-concurrency version.`)
  }
  return version
}

function durableContext(context: ExecutionContext): DurableExecutionEnvelope {
  return {
    executionId: context.executionId,
    correlationId: context.correlationId,
    ...(context.causationId ? { causationId: context.causationId } : {}),
    actor: { ...context.actor },
    initiator: { ...context.initiator },
    ...(context.tenant ? { tenant: { ...context.tenant } } : {}),
    ...(context.delegation.length > 0 ? {
      delegation: context.delegation.map((hop) => ({
        from: { ...hop.from },
        to: { ...hop.to },
        grantId: hop.grantId,
        reason: hop.reason,
        ...(hop.expiresAt ? { expiresAt: hop.expiresAt.toISOString() } : {}),
      })),
    } : {}),
    ...(context.trace.traceId || context.trace.spanId ? { trace: { ...context.trace } } : {}),
  }
}

function deliveryContext(context: ExecutionContext): DurableExecutionEnvelope {
  return {
    ...durableContext(context),
    delegation: context.delegation.map((hop) => ({
      from: { ...hop.from },
      to: { ...hop.to },
      grantId: hop.grantId,
      reason: hop.reason,
      ...(hop.expiresAt ? { expiresAt: hop.expiresAt.toISOString() } : {}),
    })),
    authentication: {
      state: context.authentication.state,
      ...(context.authentication.identityId ? { identityId: context.authentication.identityId } : {}),
      ...(context.authentication.method ? { method: context.authentication.method } : {}),
      ...(context.authentication.assurance ? { assurance: context.authentication.assurance } : {}),
      ...(context.authentication.authenticatedAt ? { authenticatedAt: context.authentication.authenticatedAt.toISOString() } : {}),
      ...(context.authentication.credentialId ? { credentialId: context.authentication.credentialId } : {}),
      ...(context.authentication.constraints ? { constraints: [...context.authentication.constraints] } : {}),
    },
    trace: { ...context.trace },
  }
}

function translatePersistenceError(error: unknown): Error {
  if (error instanceof PersistenceError) return error
  if (!postgresCode(error) && error instanceof Error) return error
  return new PersistenceError('PostgreSQL persistence operation failed.', { cause: error })
}

function postgresCode(error: unknown): string | undefined {
  let current: unknown = error
  const visited = new Set<unknown>()
  while (typeof current === 'object' && current !== null && !visited.has(current)) {
    visited.add(current)
    if ('code' in current && typeof current.code === 'string') return current.code
    current = 'cause' in current ? current.cause : undefined
  }
  return undefined
}
