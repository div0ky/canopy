import { isDeepStrictEqual } from 'node:util'

import { currentModelSession } from './model-session-context.js'
import type { JsonValue, ModelStorage, UnitOfWork } from './index.js'
import type { ModelObserverDispatcher } from './observer.js'

export interface ModelAttributes {
  id: string
}

export type ModelConstructor<
  Instance extends Model<Attributes>,
  Attributes extends ModelAttributes,
> = {
  new (attributes: Attributes): Instance
  readonly id: string
  readonly table?: string
  readonly primaryKey?: string
  readonly versionColumn?: string
  readonly columns?: Readonly<Record<string, string>>
  readonly timestamps?: boolean | { readonly createdAt: string; readonly updatedAt: string }
}

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
  changes(): ModelChanges<Attributes>
  replace(attributes: Attributes, version: number, exists: boolean): void
  attached(session: ModelSession, original: Partial<Attributes>, version?: number): void
  saved(version: number, changes: ModelChanges<Attributes>, created: boolean): void
  deleted(): void
  clearPending(): void
}

export abstract class Model<Attributes extends ModelAttributes = ModelAttributes> {
  static readonly id: string = ''
  static readonly table?: string
  static readonly primaryKey?: string
  static readonly versionColumn?: string
  static readonly columns?: Readonly<Record<string, string>>
  static readonly timestamps?: boolean | { readonly createdAt: string; readonly updatedAt: string }

  protected attributes: Attributes
  #original: Partial<Attributes> = {}
  #lastChanges: ModelChanges<Attributes> = {}
  #pendingJournal: PendingJournalFact[] = []
  #pendingOutbox: PendingOutboxMessage[] = []
  #exists = false
  #version: number | undefined
  #recentlyCreated = false
  #session: ModelSession | undefined

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
    private readonly unitOfWork: UnitOfWork,
    private readonly models: ReadonlyMap<
      Function,
      { readonly entityType: string; readonly storage: ModelStorage }
    >,
    private readonly observers?: ModelObserverDispatcher,
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
    const persisted = await this.unitOfWork.findEntity(type, id, definition.storage)
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
    const version = await this.unitOfWork.saveEntity({
      type,
      id: model.id,
      ...(internals.version !== undefined ? { expectedVersion: internals.version } : {}),
      state: clone(internals.attributes) as unknown as JsonValue,
      storage: definition.storage,
    })
    for (const fact of internals.pendingJournal) {
      await this.unitOfWork.record({
        type: fact.type,
        entityType: type,
        entityId: model.id,
        payload: fact.payload,
      })
    }
    for (const message of internals.pendingOutbox) {
      await this.unitOfWork.enqueue({
        type: message.type,
        payload: message.payload,
        ...(message.availableAt ? { availableAt: message.availableAt } : {}),
      })
    }
    internals.saved(version, changes, created)
    internals.clearPending()
    await this.observers?.dispatch(created ? 'created' : 'updated', model)
    await this.observers?.dispatch('saved', model)
    this.unitOfWork.afterCommit(() => this.observers?.dispatch('committed', model))
    return true
  }

  async delete<Attributes extends ModelAttributes>(model: Model<Attributes>): Promise<void> {
    this.assertAttached(model)
    const internals = model[MODEL_INTERNALS]()
    if (!internals.exists || internals.version === undefined) {
      throw new DetachedModelError('Cannot delete a model that has not been persisted.')
    }
    const definition = this.definitionFor(model.constructor as Function)
    const type = definition.entityType
    await this.unitOfWork.deleteEntity(type, model.id, internals.version, definition.storage)
    for (const fact of internals.pendingJournal) {
      await this.unitOfWork.record({
        type: fact.type,
        entityType: type,
        entityId: model.id,
        payload: fact.payload,
      })
    }
    for (const message of internals.pendingOutbox) {
      await this.unitOfWork.enqueue({
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
    const persisted = await this.unitOfWork.findEntity(type, model.id, definition.storage)
    if (!persisted) throw new ModelNotFoundError(model.constructor.name, model.id)
    model[MODEL_INTERNALS]().replace(
      clone(persisted.state) as unknown as Attributes,
      persisted.version,
      true,
    )
    return model
  }

  close(): void {
    this.#active = false
    this.#identityMap.clear()
  }

  private definitionFor(Constructor: Function): {
    readonly entityType: string
    readonly storage: ModelStorage
  } {
    const definition = this.models.get(Constructor)
    if (!definition)
      throw new ModelNotRegisteredError(
        `${Constructor.name} is not declared by a selected Feature.`,
      )
    return definition
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
