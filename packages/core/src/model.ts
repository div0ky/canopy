import { isDeepStrictEqual } from 'node:util'

import { currentModelSession } from './model-session-context.js'
import {
  ReadOnlyExecutionError,
  type JsonValue,
  type ModelReader,
  type ModelStorage,
  type PersistedEntity,
  type UnitOfWork,
} from './index.js'
import type { ModelObserverDispatcher } from './observer.js'
import {
  InvalidModelCursorError,
  MODEL_QUERY_MAX_PAGE_SIZE,
  ModelQuery,
  ModelQueryError,
  type ModelCursorPage,
  type ModelEagerLoadConstraints,
  type ModelPage,
  type ModelQueryPlan,
  type ModelQueryValue,
  type ModelRelationPath,
  validateModelQueryPlan,
} from './model-query.js'
import type { ModelRelationship } from './model-relation.js'

export interface ModelAttributes {
  id: string
}

/** A model-specific object whose keys name declared relationships. */
export type ModelRelations = object

export type ModelConstructor<
  Instance extends Model<Attributes, any>,
  Attributes extends ModelAttributes,
> = {
  new (attributes: Attributes): Instance
  readonly id: string
  readonly table?: string
  readonly primaryKey?: string
  readonly versionColumn?: string
  readonly columns?: Readonly<Record<string, string>>
  readonly timestamps?: boolean | { readonly createdAt: string; readonly updatedAt: string }
  readonly relationships?: Readonly<Record<string, ModelRelationship>>
}

type RelationsOf<Instance extends Model<any, any>> =
  Instance extends Model<any, infer Relations> ? Relations : never
type ModelQueryInput<Attributes extends ModelAttributes> = Partial<{
  [Key in keyof Attributes]:
    Extract<Attributes[Key], ModelQueryValue> | (undefined extends Attributes[Key] ? null : never)
}>
type ModelQueryAttributeValue<Value> =
  Extract<Value, ModelQueryValue> | (undefined extends Value ? null : never)

export type ModelChanges<Attributes extends ModelAttributes> = {
  [Key in keyof Attributes]?: Attributes[Key] | undefined
}

export interface ModelJournalFact<Payload extends JsonValue = JsonValue> {
  readonly type: string
  readonly payload: Payload
}

export interface ModelOutboxMessage<Payload extends JsonValue = JsonValue> {
  readonly type: string
  readonly payload: Payload
  readonly availableAt?: Date
}

export interface ModelQueryDiagnostic {
  readonly model: string
  readonly entityType: string
  readonly terminal: NonNullable<ModelQueryPlan['diagnostic']>['terminal']
  readonly constraintCount: number
  readonly relationshipConstraintCount: number
  readonly ordering: readonly string[]
  readonly eagerLoads: readonly string[]
  readonly limit?: number
  readonly offset?: number
  readonly pageSize?: number
  readonly storage:
    | { readonly kind: 'entity-state' }
    | {
        readonly kind: 'table'
        readonly table: string
        readonly columns: Readonly<Record<string, string>>
      }
}

export class ModelNotFoundError extends Error {
  override readonly name = 'ModelNotFoundError'

  constructor(
    readonly model: string,
    readonly id: string,
  ) {
    super(`${model} ${id} was not found.`)
  }
}

export class ModelNotRegisteredError extends Error {
  override readonly name = 'ModelNotRegisteredError'
}

export class DetachedModelError extends Error {
  override readonly name = 'DetachedModelError'
}

export class StaleModelError extends Error {
  override readonly name = 'StaleModelError'
}

const MODEL_INTERNALS = Symbol('doxa.model.internals')

interface PendingJournalFact {
  readonly type: string
  readonly payload: JsonValue
}

interface PendingOutboxMessage {
  readonly type: string
  readonly payload: JsonValue
  readonly availableAt?: Date
}

interface ModelInternals<Attributes extends ModelAttributes> {
  readonly attributes: Attributes
  readonly original: Partial<Attributes>
  readonly lastChanges: ModelChanges<Attributes>
  readonly pendingJournal: readonly PendingJournalFact[]
  readonly pendingOutbox: readonly PendingOutboxMessage[]
  readonly exists: boolean
  readonly version: number | undefined
  readonly recentlyCreated: boolean
  readonly session: ModelSession | undefined
  readonly relations: ReadonlyMap<string, Model | readonly Model[] | undefined>
  changes(): ModelChanges<Attributes>
  replace(attributes: Attributes, version: number, exists: boolean): void
  attached(session: ModelSession, original: Partial<Attributes>, version?: number): void
  saved(version: number, changes: ModelChanges<Attributes>, created: boolean): void
  deleted(): void
  clearPending(): void
  setRelation(name: string, value: Model | readonly Model[] | undefined): void
}

export abstract class Model<
  Attributes extends ModelAttributes = ModelAttributes,
  Relations extends ModelRelations = ModelRelations,
> {
  static readonly id: string = ''
  static readonly table?: string
  static readonly primaryKey?: string
  static readonly versionColumn?: string
  static readonly columns?: Readonly<Record<string, string>>
  static readonly timestamps?: boolean | { readonly createdAt: string; readonly updatedAt: string }
  static readonly relationships?: Readonly<Record<string, ModelRelationship>>

  protected attributes: Attributes
  #original: Partial<Attributes> = {}
  #lastChanges: ModelChanges<Attributes> = {}
  #pendingJournal: PendingJournalFact[] = []
  #pendingOutbox: PendingOutboxMessage[] = []
  #exists = false
  #version: number | undefined
  #recentlyCreated = false
  #session: ModelSession | undefined
  readonly #relations = new Map<string, Model | readonly Model[] | undefined>()
  declare protected readonly __doxaRelations: Relations

  constructor(attributes: Attributes) {
    this.attributes = clone(attributes)
  }

  static find<Attributes extends ModelAttributes, Instance extends Model<Attributes>>(
    this: ModelConstructor<Instance, Attributes>,
    id: string,
  ): Promise<Instance | undefined> {
    return requireCurrentSession().find(this, id)
  }

  static findOrFail<Attributes extends ModelAttributes, Instance extends Model<Attributes>>(
    this: ModelConstructor<Instance, Attributes>,
    id: string,
  ): Promise<Instance> {
    return requireCurrentSession().findOrFail(this, id)
  }

  static make<Attributes extends ModelAttributes, Instance extends Model<Attributes>>(
    this: ModelConstructor<Instance, Attributes>,
    attributes: Attributes,
  ): Instance {
    return requireCurrentSession().make(this, attributes)
  }

  static async create<Attributes extends ModelAttributes, Instance extends Model<Attributes>>(
    this: ModelConstructor<Instance, Attributes>,
    attributes: Attributes,
  ): Promise<Instance> {
    const model = requireCurrentSession().make(this, attributes)
    await model.save()
    return model
  }

  static query<Attributes extends ModelAttributes, Instance extends Model<Attributes, any>>(
    this: ModelConstructor<Instance, Attributes>,
  ): ModelQuery<Instance, Attributes, RelationsOf<Instance>> {
    return new ModelQuery(this)
  }

  static where<Attributes extends ModelAttributes, Instance extends Model<Attributes, any>>(
    this: ModelConstructor<Instance, Attributes>,
    input: ModelQueryInput<Attributes>,
  ): ModelQuery<Instance, Attributes, RelationsOf<Instance>>
  static where<
    Attributes extends ModelAttributes,
    Instance extends Model<Attributes, any>,
    Key extends Extract<keyof Attributes, string>,
  >(
    this: ModelConstructor<Instance, Attributes>,
    attribute: Key,
    value: ModelQueryAttributeValue<Attributes[Key]>,
  ): ModelQuery<Instance, Attributes, RelationsOf<Instance>>
  static where<
    Attributes extends ModelAttributes,
    Instance extends Model<Attributes, any>,
    Key extends Extract<keyof Attributes, string>,
  >(
    this: ModelConstructor<Instance, Attributes>,
    attribute: Key,
    operator: NonNullable<Attributes[Key]> extends string
      ? import('./model-query.js').ModelQueryOperator
      : NonNullable<Attributes[Key]> extends number | Date
        ? '=' | '!=' | '<' | '<=' | '>' | '>='
        : '=' | '!=',
    value: ModelQueryAttributeValue<Attributes[Key]>,
  ): ModelQuery<Instance, Attributes, RelationsOf<Instance>>
  static where<Attributes extends ModelAttributes, Instance extends Model<Attributes, any>>(
    this: ModelConstructor<Instance, Attributes>,
    input: ModelQueryInput<Attributes> | Extract<keyof Attributes, string>,
    operatorOrValue?:
      | import('./model-query.js').ModelQueryOperator
      | ModelQueryAttributeValue<Attributes[Extract<keyof Attributes, string>]>,
    value?: ModelQueryAttributeValue<Attributes[Extract<keyof Attributes, string>]>,
  ): ModelQuery<Instance, Attributes, RelationsOf<Instance>> {
    const query = new ModelQuery<Instance, Attributes, RelationsOf<Instance>>(this)
    if (typeof input === 'object') return query.where(input)
    return value === undefined
      ? query.where(input, operatorOrValue as never)
      : query.where(input, operatorOrValue as never, value as never)
  }

  static with<Attributes extends ModelAttributes, Instance extends Model<Attributes, any>>(
    this: ModelConstructor<Instance, Attributes>,
    relations:
      | ModelRelationPath<RelationsOf<Instance>>
      | readonly ModelRelationPath<RelationsOf<Instance>>[],
  ): ModelQuery<Instance, Attributes, RelationsOf<Instance>>
  static with<Attributes extends ModelAttributes, Instance extends Model<Attributes, any>>(
    this: ModelConstructor<Instance, Attributes>,
    relations: ModelEagerLoadConstraints<RelationsOf<Instance>>,
  ): ModelQuery<Instance, Attributes, RelationsOf<Instance>>
  static with<Attributes extends ModelAttributes, Instance extends Model<Attributes, any>>(
    this: ModelConstructor<Instance, Attributes>,
    relations:
      | ModelRelationPath<RelationsOf<Instance>>
      | readonly ModelRelationPath<RelationsOf<Instance>>[]
      | ModelEagerLoadConstraints<RelationsOf<Instance>>,
  ): ModelQuery<Instance, Attributes, RelationsOf<Instance>> {
    const query = new ModelQuery<Instance, Attributes, RelationsOf<Instance>>(this)
    return typeof relations === 'string' || Array.isArray(relations)
      ? query.with(
          relations as
            | ModelRelationPath<RelationsOf<Instance>>
            | readonly ModelRelationPath<RelationsOf<Instance>>[],
        )
      : query.with(relations as ModelEagerLoadConstraints<RelationsOf<Instance>>)
  }

  get id(): string {
    return this.attributes.id
  }

  get exists(): boolean {
    return this.#exists
  }

  get version(): number | undefined {
    return this.#version
  }

  get wasRecentlyCreated(): boolean {
    return this.#recentlyCreated
  }

  getAttribute<Key extends keyof Attributes>(key: Key): Attributes[Key]
  getAttribute(key: string): unknown
  getAttribute(key: string): unknown {
    return clone((this.attributes as Record<string, unknown>)[key])
  }

  isDirty(key?: keyof Attributes): boolean {
    if (key) return !isDeepStrictEqual(this.attributes[key], this.#original[key])
    return Object.keys(this.currentChanges()).length > 0
  }

  isClean(key?: keyof Attributes): boolean {
    return !this.isDirty(key)
  }

  wasChanged(key?: keyof Attributes): boolean {
    return key ? Object.hasOwn(this.#lastChanges, key) : Object.keys(this.#lastChanges).length > 0
  }

  getChanges(): ModelChanges<Attributes> {
    return clone(this.#lastChanges)
  }

  getOriginal(): Partial<Attributes>
  getOriginal<Key extends keyof Attributes>(key: Key): Attributes[Key] | undefined
  getOriginal<Key extends keyof Attributes>(
    key?: Key,
  ): Partial<Attributes> | Attributes[Key] | undefined {
    return key ? clone(this.#original[key]) : clone(this.#original)
  }

  save(): Promise<boolean> {
    return this.attachedSession().save(this)
  }

  delete(): Promise<void> {
    return this.attachedSession().delete(this)
  }

  refresh(): Promise<this> {
    return this.attachedSession().refresh(this)
  }

  protected related<Key extends keyof Relations>(key: Key): Relations[Key] {
    if (!this.#relations.has(String(key))) {
      throw new ModelQueryError(
        `${this.constructor.name}.${String(key)} is not loaded; include it with with('${String(key)}').`,
      )
    }
    return this.#relations.get(String(key)) as Relations[Key]
  }

  protected journal<Payload extends JsonValue>(type: string, payload: Payload): void {
    this.#pendingJournal.push({ type, payload: clone(payload) })
  }

  protected outbox<Payload extends JsonValue>(
    type: string,
    payload: Payload,
    availableAt?: Date,
  ): void {
    this.#pendingOutbox.push({
      type,
      payload: clone(payload),
      ...(availableAt ? { availableAt: new Date(availableAt) } : {}),
    })
  }

  [MODEL_INTERNALS](): ModelInternals<Attributes> {
    return {
      attributes: this.attributes,
      original: this.#original,
      lastChanges: this.#lastChanges,
      pendingJournal: this.#pendingJournal,
      pendingOutbox: this.#pendingOutbox,
      exists: this.#exists,
      version: this.#version,
      recentlyCreated: this.#recentlyCreated,
      session: this.#session,
      relations: this.#relations,
      changes: () => this.currentChanges(),
      replace: (attributes, version, exists) => {
        this.attributes = clone(attributes)
        this.#original = clone(attributes)
        this.#lastChanges = {}
        this.#version = version
        this.#exists = exists
        this.#recentlyCreated = false
        this.#pendingJournal = []
        this.#pendingOutbox = []
      },
      attached: (session, original, version) => {
        this.#session = session
        this.#original = clone(original)
        this.#version = version
        this.#exists = version !== undefined
      },
      saved: (version, changes, created) => {
        this.#version = version
        this.#exists = true
        this.#recentlyCreated = created
        this.#lastChanges = clone(changes)
        this.#original = clone(this.attributes)
      },
      deleted: () => {
        this.#exists = false
        this.#recentlyCreated = false
      },
      clearPending: () => {
        this.#pendingJournal = []
        this.#pendingOutbox = []
      },
      setRelation: (name, value) => {
        this.#relations.set(name, value)
      },
    }
  }

  private currentChanges(): ModelChanges<Attributes> {
    const changes: ModelChanges<Attributes> = {}
    const keys = new Set([...Object.keys(this.#original), ...Object.keys(this.attributes)]) as Set<
      keyof Attributes
    >
    for (const key of keys) {
      if (!isDeepStrictEqual(this.attributes[key], this.#original[key])) {
        changes[key] = clone(this.attributes[key])
      }
    }
    return changes
  }

  private attachedSession(): ModelSession {
    const current = currentModelSession<ModelSession>()
    if (!this.#session)
      throw new DetachedModelError('Model is not attached to a Doxa ModelSession.')
    if (!current || current !== this.#session || !current.active) {
      throw new StaleModelError('Model belongs to an execution that is no longer active.')
    }
    return current
  }
}

export class ModelSession {
  #active = true
  readonly #identityMap = new Map<string, Model>()

  constructor(
    private readonly reader: ModelReader,
    private readonly models: ReadonlyMap<
      Function,
      {
        readonly entityType: string
        readonly storage: ModelStorage
        readonly attributes?: ReadonlySet<string>
      }
    >,
    private readonly observers?: ModelObserverDispatcher,
    private readonly writable = true,
    private readonly queryDiagnostics?: (diagnostic: ModelQueryDiagnostic) => void | Promise<void>,
  ) {}

  get active(): boolean {
    return this.#active
  }

  async find<Attributes extends ModelAttributes, Instance extends Model<Attributes>>(
    Constructor: ModelConstructor<Instance, Attributes>,
    id: string,
  ): Promise<Instance | undefined> {
    this.assertActive()
    const definition = this.definitionFor(Constructor)
    const type = definition.entityType
    const identity = `${type}/${id}`
    const existing = this.#identityMap.get(identity)
    if (existing) return existing as Instance
    const persisted = await this.reader.findEntity(type, id, definition.storage)
    if (!persisted) return undefined
    const attributes = clone(persisted.state) as unknown as Attributes
    const model = new Constructor(attributes)
    model[MODEL_INTERNALS]().attached(this, attributes, persisted.version)
    this.#identityMap.set(identity, model)
    await this.observers?.dispatch('retrieved', model)
    return model
  }

  async findOrFail<Attributes extends ModelAttributes, Instance extends Model<Attributes>>(
    Constructor: ModelConstructor<Instance, Attributes>,
    id: string,
  ): Promise<Instance> {
    const model = await this.find(Constructor, id)
    if (!model) throw new ModelNotFoundError(Constructor.name, id)
    return model
  }

  make<Attributes extends ModelAttributes, Instance extends Model<Attributes>>(
    Constructor: ModelConstructor<Instance, Attributes>,
    attributes: Attributes,
  ): Instance {
    this.assertActive()
    this.assertWritable()
    const type = this.definitionFor(Constructor).entityType
    const identity = `${type}/${attributes.id}`
    if (this.#identityMap.has(identity)) {
      throw new Error(`${Constructor.name} ${attributes.id} is already attached to this execution.`)
    }
    const model = new Constructor(clone(attributes))
    model[MODEL_INTERNALS]().attached(this, {})
    this.#identityMap.set(identity, model)
    return model
  }

  async save<Attributes extends ModelAttributes>(model: Model<Attributes>): Promise<boolean> {
    this.assertAttached(model)
    this.assertWritable()
    const internals = model[MODEL_INTERNALS]()
    let changes = model.isDirty() ? internals.changes() : {}
    const hasDurableWork = internals.pendingJournal.length > 0 || internals.pendingOutbox.length > 0
    if (Object.keys(changes).length === 0 && !hasDurableWork) return false
    const created = !internals.exists
    await this.observers?.dispatch('saving', model)
    await this.observers?.dispatch(created ? 'creating' : 'updating', model)
    changes = model.isDirty() ? internals.changes() : {}
    const definition = this.definitionFor(model.constructor as Function)
    const type = definition.entityType
    const version = await this.writer().saveEntity({
      type,
      id: model.id,
      ...(internals.version !== undefined ? { expectedVersion: internals.version } : {}),
      state: clone(internals.attributes) as unknown as JsonValue,
      storage: definition.storage,
    })
    for (const fact of internals.pendingJournal) {
      await this.writer().record({
        type: fact.type,
        entityType: type,
        entityId: model.id,
        payload: fact.payload,
      })
    }
    for (const message of internals.pendingOutbox) {
      await this.writer().enqueue({
        type: message.type,
        payload: message.payload,
        ...(message.availableAt ? { availableAt: message.availableAt } : {}),
      })
    }
    internals.saved(version, changes, created)
    internals.clearPending()
    await this.observers?.dispatch(created ? 'created' : 'updated', model)
    await this.observers?.dispatch('saved', model)
    this.writer().afterCommit(() => this.observers?.dispatch('committed', model))
    return true
  }

  async delete<Attributes extends ModelAttributes>(model: Model<Attributes>): Promise<void> {
    this.assertAttached(model)
    this.assertWritable()
    const internals = model[MODEL_INTERNALS]()
    if (!internals.exists || internals.version === undefined) {
      throw new DetachedModelError('Cannot delete a model that has not been persisted.')
    }
    const definition = this.definitionFor(model.constructor as Function)
    const type = definition.entityType
    await this.writer().deleteEntity(type, model.id, internals.version, definition.storage)
    for (const fact of internals.pendingJournal) {
      await this.writer().record({
        type: fact.type,
        entityType: type,
        entityId: model.id,
        payload: fact.payload,
      })
    }
    for (const message of internals.pendingOutbox) {
      await this.writer().enqueue({
        type: message.type,
        payload: message.payload,
        ...(message.availableAt ? { availableAt: message.availableAt } : {}),
      })
    }
    internals.deleted()
    internals.clearPending()
    this.#identityMap.delete(`${type}/${model.id}`)
  }

  async refresh<Attributes extends ModelAttributes, Instance extends Model<Attributes>>(
    model: Instance,
  ): Promise<Instance> {
    this.assertAttached(model)
    const definition = this.definitionFor(model.constructor as Function)
    const type = definition.entityType
    const persisted = await this.reader.findEntity(type, model.id, definition.storage)
    if (!persisted) throw new ModelNotFoundError(model.constructor.name, model.id)
    model[MODEL_INTERNALS]().replace(
      clone(persisted.state) as unknown as Attributes,
      persisted.version,
      true,
    )
    return model
  }

  async query<
    Attributes extends ModelAttributes,
    Relations extends ModelRelations,
    Instance extends Model<Attributes, Relations>,
  >(
    Constructor: ModelConstructor<Instance, Attributes>,
    plan: ModelQueryPlan,
  ): Promise<readonly Instance[]> {
    this.assertActive()
    const definition = this.definitionFor(Constructor)
    await this.diagnose(Constructor, definition, plan)
    const resolvedPlan = await this.resolveRelationshipConstraints(Constructor, plan)
    const persisted = await this.reader.queryEntities<Attributes & JsonValue>(
      definition.entityType,
      definition.storage,
      resolvedPlan,
    )
    const models: Instance[] = []
    for (const entity of persisted)
      models.push(await this.hydrate(Constructor, definition.entityType, entity))
    if (resolvedPlan.eagerLoads.length > 0) {
      await this.eagerLoad(models, Constructor, resolvedPlan.eagerLoads)
    }
    return models
  }

  async queryValues<
    Attributes extends ModelAttributes,
    Relations extends ModelRelations,
    Instance extends Model<Attributes, Relations>,
  >(
    Constructor: ModelConstructor<Instance, Attributes>,
    plan: ModelQueryPlan,
    attribute: keyof Attributes & string,
  ): Promise<readonly Attributes[keyof Attributes][]> {
    this.assertActive()
    const definition = this.definitionFor(Constructor)
    await this.diagnose(Constructor, definition, plan)
    const resolvedPlan = await this.resolveRelationshipConstraints(Constructor, plan)
    const persisted = await this.reader.queryEntities<Attributes & JsonValue>(
      definition.entityType,
      definition.storage,
      { ...resolvedPlan, eagerLoads: [] },
    )
    return persisted.map((entity) => (entity.state as Attributes)[attribute])
  }

  async queryAggregate<
    Attributes extends ModelAttributes,
    Relations extends ModelRelations,
    Instance extends Model<Attributes, Relations>,
  >(
    Constructor: ModelConstructor<Instance, Attributes>,
    plan: ModelQueryPlan,
    operation: 'count' | 'min' | 'max' | 'sum' | 'average',
    attribute?: keyof Attributes & string,
  ): Promise<number | ModelQueryValue | undefined> {
    this.assertActive()
    const definition = this.definitionFor(Constructor)
    await this.diagnose(Constructor, definition, plan)
    const resolvedPlan = await this.resolveRelationshipConstraints(Constructor, plan)
    return this.reader.aggregateEntities(
      definition.entityType,
      definition.storage,
      { ...resolvedPlan, eagerLoads: [] },
      operation,
      attribute,
    )
  }

  async paginate<
    Attributes extends ModelAttributes,
    Relations extends ModelRelations,
    Instance extends Model<Attributes, Relations>,
  >(
    Constructor: ModelConstructor<Instance, Attributes>,
    plan: ModelQueryPlan,
    page: number,
    perPage: number,
  ): Promise<ModelPage<Instance>> {
    positiveInteger(page, 'Page')
    boundedPositiveInteger(perPage, 'Per-page value', MODEL_QUERY_MAX_PAGE_SIZE)
    const offset = (page - 1) * perPage
    if (!Number.isSafeInteger(offset)) {
      throw new ModelQueryError('Pagination offset exceeds the supported integer range.')
    }
    const definition = this.definitionFor(Constructor)
    const orders = deterministicOrders(plan.orders)
    await this.diagnose(Constructor, definition, { ...plan, orders }, perPage)
    const { diagnostic: _diagnostic, ...silentPlan } = plan
    const total = Number(await this.queryAggregate(Constructor, silentPlan, 'count'))
    const items = await this.query(Constructor, {
      ...silentPlan,
      orders,
      limit: perPage,
      offset,
    })
    return Object.freeze({
      items,
      page,
      perPage,
      total,
      lastPage: Math.max(1, Math.ceil(total / perPage)),
    })
  }

  async cursorPaginate<
    Attributes extends ModelAttributes,
    Relations extends ModelRelations,
    Instance extends Model<Attributes, Relations>,
  >(
    Constructor: ModelConstructor<Instance, Attributes>,
    plan: ModelQueryPlan,
    input: { readonly first: number; readonly after?: string; readonly before?: string },
  ): Promise<ModelCursorPage<Instance>> {
    boundedPositiveInteger(input.first, 'Cursor page size', MODEL_QUERY_MAX_PAGE_SIZE)
    if (input.after && input.before) {
      throw new InvalidModelCursorError(
        'Cursor pagination accepts either after or before, not both.',
      )
    }
    const definition = this.definitionFor(Constructor)
    const { diagnostic: _diagnostic, ...silentPlan } = plan
    const orders = deterministicOrders(silentPlan.orders)
    await this.diagnose(Constructor, definition, { ...plan, orders }, input.first)
    const cursor = input.after ?? input.before
    const reverse = input.before !== undefined
    const positioned = cursor
      ? addCursorConstraint(
          silentPlan,
          orders,
          decodeCursor(cursor, Constructor, orders),
          reverse ? 'before' : 'after',
        )
      : silentPlan
    const executionOrders = reverse
      ? orders.map((order) => ({
          ...order,
          direction: order.direction === 'asc' ? ('desc' as const) : ('asc' as const),
        }))
      : orders
    const { offset: _offset, ...withoutOffset } = positioned
    let items = await this.query(Constructor, {
      ...withoutOffset,
      orders: executionOrders,
      limit: input.first + 1,
    })
    const hasMore = items.length > input.first
    if (hasMore) items = items.slice(0, input.first)
    if (reverse) items = [...items].reverse()
    const first = items[0]
    const last = items.at(-1)
    return Object.freeze({
      items,
      ...(last && ((!reverse && hasMore) || input.before)
        ? { nextCursor: encodeCursor(last, orders) }
        : {}),
      ...(first && ((reverse && hasMore) || input.after)
        ? { previousCursor: encodeCursor(first, orders) }
        : {}),
    })
  }

  close(): void {
    this.#active = false
    this.#identityMap.clear()
  }

  private definitionFor(Constructor: Function): {
    readonly entityType: string
    readonly storage: ModelStorage
    readonly attributes?: ReadonlySet<string>
  } {
    const definition = this.models.get(Constructor)
    if (!definition)
      throw new ModelNotRegisteredError(
        `${Constructor.name} is not declared by a selected Feature.`,
      )
    return definition
  }

  private async hydrate<
    Attributes extends ModelAttributes,
    Instance extends Model<Attributes, any>,
  >(
    Constructor: ModelConstructor<Instance, Attributes>,
    type: string,
    persisted: PersistedEntity,
  ): Promise<Instance> {
    const identity = `${type}/${persisted.id}`
    const existing = this.#identityMap.get(identity)
    if (existing) return existing as Instance
    const attributes = clone(persisted.state) as unknown as Attributes
    const model = new Constructor(attributes)
    model[MODEL_INTERNALS]().attached(this, attributes, persisted.version)
    this.#identityMap.set(identity, model)
    await this.observers?.dispatch('retrieved', model)
    return model
  }

  private async eagerLoad<
    Attributes extends ModelAttributes,
    Instance extends Model<Attributes, any>,
  >(
    parents: readonly Instance[],
    Constructor: ModelConstructor<Instance, Attributes>,
    eagerLoads: ModelQueryPlan['eagerLoads'],
  ): Promise<void> {
    if (parents.length === 0) return
    const grouped = new Map<
      string,
      { constrain?: ModelQueryPlan['eagerLoads'][number]['constrain']; nested: string[] }
    >()
    for (const load of eagerLoads) {
      const [name, ...rest] = load.path.split('.')
      if (!name) throw new ModelQueryError('Relationship paths cannot be empty.')
      const current = grouped.get(name) ?? { nested: [] }
      if (load.constrain) current.constrain = load.constrain
      if (rest.length > 0) current.nested.push(rest.join('.'))
      grouped.set(name, current)
    }
    for (const [name, load] of grouped) {
      const relationship = Constructor.relationships?.[name]
      if (!relationship)
        throw new ModelQueryError(`${Constructor.name}.${name} is not a declared relationship.`)
      const related = relationship.related()
      let relatedQuery: ModelQuery<
        any,
        any,
        Record<string, Model | readonly Model[] | undefined>
      > = new ModelQuery(related)
      if (load.constrain) {
        const constrained = load.constrain(relatedQuery)
        if (!(constrained instanceof ModelQuery) || constrained.Constructor !== related) {
          throw new ModelQueryError(
            `${Constructor.name}.${name} eager-load constraints must return its related model query.`,
          )
        }
        relatedQuery = constrained
      }
      if (load.nested.length > 0) relatedQuery = relatedQuery.with(load.nested)
      if (relationship.kind === 'belongsTo') {
        const keys = uniqueValues(
          parents.map((parent) => attribute(parent, relationship.foreignKey)),
        )
        const relatedModels = await relatedQuery
          .whereIn(relationship.ownerKey as 'id', keys as string[])
          .get()
        const byKey = new Map(
          relatedModels.map((model) => [attribute(model, relationship.ownerKey), model]),
        )
        for (const parent of parents) {
          parent[MODEL_INTERNALS]().setRelation(
            name,
            byKey.get(attribute(parent, relationship.foreignKey)),
          )
        }
        continue
      }
      if (relationship.kind === 'hasOne' || relationship.kind === 'hasMany') {
        const keys = uniqueValues(parents.map((parent) => attribute(parent, relationship.localKey)))
        const relatedModels = await relatedQuery
          .whereIn(relationship.foreignKey as 'id', keys as string[])
          .get()
        for (const parent of parents) {
          const key = attribute(parent, relationship.localKey)
          const matches = relatedModels.filter((model) =>
            sameValue(attribute(model, relationship.foreignKey), key),
          )
          parent[MODEL_INTERNALS]().setRelation(
            name,
            relationship.kind === 'hasOne' ? matches[0] : matches,
          )
        }
        continue
      }
      const through = relationship.through()
      const parentKeys = uniqueValues(
        parents.map((parent) => attribute(parent, relationship.localKey)),
      )
      const pivots = await new ModelQuery(through)
        .whereIn(relationship.foreignKey as 'id', parentKeys as string[])
        .get()
      const relatedKeys = uniqueValues(
        pivots.map((pivot) => attribute(pivot, relationship.relatedForeignKey)),
      )
      const relatedModels = await relatedQuery
        .whereIn(relationship.relatedKey as 'id', relatedKeys as string[])
        .get()
      for (const parent of parents) {
        const parentKey = attribute(parent, relationship.localKey)
        const ids = pivots
          .filter((pivot) => sameValue(attribute(pivot, relationship.foreignKey), parentKey))
          .map((pivot) => attribute(pivot, relationship.relatedForeignKey))
        parent[MODEL_INTERNALS]().setRelation(
          name,
          relatedModels.filter((model) =>
            ids.some((id) => sameValue(attribute(model, relationship.relatedKey), id)),
          ),
        )
      }
    }
  }

  private async resolveRelationshipConstraints<
    Attributes extends ModelAttributes,
    Instance extends Model<Attributes, any>,
  >(
    Constructor: ModelConstructor<Instance, Attributes>,
    plan: ModelQueryPlan,
  ): Promise<ModelQueryPlan> {
    const attributes = this.definitionFor(Constructor).attributes
    validateModelQueryPlan(plan, attributes)
    if (plan.relationshipConstraints.length === 0) return plan
    const constraints = [...plan.constraints]
    for (const constraint of plan.relationshipConstraints) {
      const [name, ...nested] = constraint.path.split('.')
      if (!name) throw new ModelQueryError('Relationship paths cannot be empty.')
      const relationship = Constructor.relationships?.[name]
      if (!relationship) {
        throw new ModelQueryError(`${Constructor.name}.${name} is not a declared relationship.`)
      }
      const Related = relationship.related()
      let relatedQuery: ModelQuery<
        any,
        any,
        Record<string, Model | readonly Model[] | undefined>
      > = new ModelQuery(Related)
      if (nested.length > 0) relatedQuery = relatedQuery.whereHas(nested.join('.'))
      if (constraint.constrain) {
        const constrained = constraint.constrain(relatedQuery)
        if (!(constrained instanceof ModelQuery) || constrained.Constructor !== Related) {
          throw new ModelQueryError(
            `${Constructor.name}.${name} relationship constraints must return its related model query.`,
          )
        }
        relatedQuery = constrained
      }

      let attributeName: string
      let matchingValues: readonly unknown[]
      let observedCounts: ReadonlyMap<unknown, number> | undefined
      if (relationship.kind === 'belongsTo') {
        attributeName = relationship.foreignKey
        matchingValues = await relatedQuery.pluck(relationship.ownerKey as 'id')
      } else if (relationship.kind === 'hasOne' || relationship.kind === 'hasMany') {
        attributeName = relationship.localKey
        const foreignKeys = await relatedQuery.pluck(relationship.foreignKey as 'id')
        observedCounts = countValues(foreignKeys)
        matchingValues = relationshipKeysForCount(observedCounts, constraint)
      } else {
        attributeName = relationship.localKey
        const relatedKeys = await relatedQuery.pluck(relationship.relatedKey as 'id')
        const pivots = await new ModelQuery(relationship.through())
          .whereIn(relationship.relatedForeignKey as 'id', relatedKeys as string[])
          .pluck(relationship.foreignKey as 'id')
        observedCounts = countValues(pivots)
        matchingValues = relationshipKeysForCount(observedCounts, constraint)
      }

      const zeroMatches = countComparison(0, constraint.operator, constraint.count)
      const oneMatches = countComparison(1, constraint.operator, constraint.count)
      const negate = relationship.kind === 'belongsTo' ? zeroMatches && !oneMatches : zeroMatches
      const values =
        relationship.kind === 'belongsTo'
          ? matchingValues
          : negate
            ? [...(observedCounts ?? new Map()).entries()]
                .filter(
                  ([, count]) => !countComparison(count, constraint.operator, constraint.count),
                )
                .map(([key]) => key)
            : matchingValues
      if (relationship.kind === 'belongsTo' && zeroMatches === oneMatches) {
        if (zeroMatches) continue
        constraints.push({
          boolean: 'and',
          predicate: { kind: 'membership', attribute: attributeName, values: [], negate: false },
        })
        continue
      }
      constraints.push({
        boolean: 'and',
        predicate: {
          kind: 'membership',
          attribute: attributeName,
          values: values as readonly ModelQueryValue[],
          negate,
        },
      })
    }
    const resolved = { ...plan, constraints, relationshipConstraints: [] }
    validateModelQueryPlan(resolved, attributes)
    return resolved
  }

  private async diagnose<
    Attributes extends ModelAttributes,
    Instance extends Model<Attributes, any>,
  >(
    Constructor: ModelConstructor<Instance, Attributes>,
    definition: { readonly entityType: string; readonly storage: ModelStorage },
    plan: ModelQueryPlan,
    pageSize?: number,
  ): Promise<void> {
    if (!plan.diagnostic || !this.queryDiagnostics) return
    const storage =
      definition.storage.kind === 'entity-state'
        ? { kind: 'entity-state' as const }
        : {
            kind: 'table' as const,
            table: definition.storage.table,
            columns: definition.storage.columns,
          }
    await this.queryDiagnostics({
      model: Constructor.name,
      entityType: definition.entityType,
      terminal: plan.diagnostic.terminal,
      constraintCount: countConstraints(plan.constraints),
      relationshipConstraintCount: plan.relationshipConstraints.length,
      ordering: plan.orders.map((order) => `${order.attribute}:${order.direction}`),
      eagerLoads: plan.eagerLoads.map((load) => load.path),
      ...(plan.limit === undefined ? {} : { limit: plan.limit }),
      ...(plan.offset === undefined ? {} : { offset: plan.offset }),
      ...(pageSize === undefined ? {} : { pageSize }),
      storage,
    })
  }

  private assertAttached(model: Model): void {
    this.assertActive()
    if (model[MODEL_INTERNALS]().session !== this) {
      throw new DetachedModelError('Model is not attached to the current ModelSession.')
    }
  }

  private assertActive(): void {
    if (!this.#active) throw new StaleModelError('ModelSession is no longer active.')
  }

  private assertWritable(): void {
    if (!this.writable)
      throw new ReadOnlyExecutionError('Model mutation is not allowed in a query execution.')
  }

  private writer(): UnitOfWork {
    this.assertWritable()
    return this.reader as UnitOfWork
  }
}

function requireCurrentSession(): ModelSession {
  const session = currentModelSession<ModelSession>()
  if (!session || !session.active) {
    throw new StaleModelError('A model operation requires an active Doxa action ModelSession.')
  }
  return session
}

function clone<Value>(value: Value): Value {
  return structuredClone(value)
}

function attribute(model: Model, name: string): unknown {
  return (model[MODEL_INTERNALS]().attributes as unknown as Record<string, unknown>)[name]
}

function uniqueValues(values: readonly unknown[]): unknown[] {
  return values.filter(
    (value, index) =>
      value !== undefined && values.findIndex((candidate) => sameValue(candidate, value)) === index,
  )
}

function sameValue(left: unknown, right: unknown): boolean {
  return isDeepStrictEqual(left, right)
}

function countValues(values: readonly unknown[]): ReadonlyMap<unknown, number> {
  const counts = new Map<unknown, number>()
  for (const value of values) {
    if (value === undefined) continue
    const existing = [...counts.keys()].find((key) => sameValue(key, value))
    counts.set(existing ?? value, (existing === undefined ? 0 : (counts.get(existing) ?? 0)) + 1)
  }
  return counts
}

function relationshipKeysForCount(
  counts: ReadonlyMap<unknown, number>,
  constraint: ModelQueryPlan['relationshipConstraints'][number],
): readonly unknown[] {
  return [...counts.entries()]
    .filter(([, count]) => countComparison(count, constraint.operator, constraint.count))
    .map(([key]) => key)
}

function countComparison(
  actual: number,
  operator: ModelQueryPlan['relationshipConstraints'][number]['operator'],
  expected: number,
): boolean {
  if (operator === '=') return actual === expected
  if (operator === '!=') return actual !== expected
  if (operator === '<') return actual < expected
  if (operator === '<=') return actual <= expected
  if (operator === '>') return actual > expected
  return actual >= expected
}

function countConstraints(constraints: ModelQueryPlan['constraints']): number {
  return constraints.reduce(
    (count, constraint) =>
      count +
      1 +
      (constraint.predicate.kind === 'group'
        ? countConstraints(constraint.predicate.predicates)
        : 0),
    0,
  )
}

function positiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new ModelQueryError(`${name} must be a positive integer.`)
}

function boundedPositiveInteger(value: number, name: string, maximum: number): void {
  positiveInteger(value, name)
  if (value > maximum) throw new ModelQueryError(`${name} must be at most ${maximum}.`)
}

function deterministicOrders(orders: ModelQueryPlan['orders']): ModelQueryPlan['orders'] {
  return orders.some((order) => order.attribute === 'id')
    ? orders
    : [...orders, { attribute: 'id', direction: 'asc' }]
}

function encodeCursor(model: Model, orders: ModelQueryPlan['orders']): string {
  const Constructor = model.constructor as typeof Model
  return Buffer.from(
    JSON.stringify({
      version: 1,
      model: Constructor.id,
      ordering: orders.map((order) => [order.attribute, order.direction]),
      values: orders.map((order) => attribute(model, order.attribute)),
    }),
  ).toString('base64url')
}

function decodeCursor(
  cursor: string,
  Constructor: { readonly id: string },
  orders: ModelQueryPlan['orders'],
): readonly ModelQueryValue[] {
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      version?: unknown
      model?: unknown
      ordering?: unknown
      values?: unknown
    }
    const expectedOrdering = orders.map((order) => [order.attribute, order.direction])
    if (
      decoded.version !== 1 ||
      decoded.model !== Constructor.id ||
      !isDeepStrictEqual(decoded.ordering, expectedOrdering) ||
      !Array.isArray(decoded.values)
    ) {
      throw new Error('invalid')
    }
    return decoded.values.map((value) => {
      if (
        value === null ||
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
      ) {
        return value
      }
      throw new Error('invalid')
    })
  } catch {
    throw new InvalidModelCursorError('Model cursor is invalid or unsupported.')
  }
}

function addCursorConstraint(
  plan: ModelQueryPlan,
  orders: ModelQueryPlan['orders'],
  values: readonly ModelQueryValue[],
  position: 'after' | 'before',
): ModelQueryPlan {
  if (values.length !== orders.length)
    throw new InvalidModelCursorError('Model cursor does not match query ordering.')
  const alternatives = orders.map((order, index) => {
    const equals = orders.slice(0, index).map((previous, previousIndex) => ({
      boolean: 'and' as const,
      predicate: {
        kind: 'comparison' as const,
        attribute: previous.attribute,
        operator: '=' as const,
        value: values[previousIndex]!,
      },
    }))
    const forward = order.direction === 'asc' ? '>' : '<'
    const operator: import('./model-query.js').ModelQueryOperator =
      position === 'after' ? forward : forward === '>' ? '<' : '>'
    return {
      boolean: index === 0 ? ('and' as const) : ('or' as const),
      predicate: {
        kind: 'group' as const,
        predicates: [
          ...equals,
          {
            boolean: 'and' as const,
            predicate: {
              kind: 'comparison' as const,
              attribute: order.attribute,
              operator,
              value: values[index]!,
            },
          },
        ],
      },
    }
  })
  return {
    ...plan,
    constraints: [
      ...plan.constraints,
      { boolean: 'and', predicate: { kind: 'group', predicates: alternatives } },
    ],
  }
}
