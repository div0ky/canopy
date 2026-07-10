import type { DomainEvent } from '../events/events.js';

export type ModelId = string | number;
export type ModelAttributes = Readonly<Record<string, unknown>>;

export interface ModelSnapshot<TId extends ModelId, TAttributes extends ModelAttributes> {
  readonly id: TId;
  readonly attributes: TAttributes;
  readonly version: number;
}

export abstract class DomainModel<TId extends ModelId, TAttributes extends ModelAttributes> {
  readonly #id: TId;
  #original: TAttributes;
  #attributes: TAttributes;
  #version: number;
  #persisted: boolean;
  #deleted = false;
  #events: DomainEvent[] = [];

  protected constructor(snapshot: ModelSnapshot<TId, TAttributes>, persisted = true) {
    this.#id = snapshot.id;
    this.#original = structuredClone(snapshot.attributes);
    this.#attributes = structuredClone(snapshot.attributes);
    this.#version = snapshot.version;
    this.#persisted = persisted;
  }

  public get id(): TId {
    return this.#id;
  }

  public get version(): number {
    return this.#version;
  }

  public get exists(): boolean {
    return this.#persisted && !this.#deleted;
  }

  public get trashed(): boolean {
    return this.#deleted;
  }

  public get attributes(): TAttributes {
    return structuredClone(this.#attributes);
  }

  public get original(): TAttributes {
    return structuredClone(this.#original);
  }

  public get dirty(): Partial<TAttributes> {
    const dirty: Partial<TAttributes> = {};
    for (const key of Object.keys(this.#attributes) as Array<keyof TAttributes>) {
      if (!Object.is(this.#attributes[key], this.#original[key])) {
        dirty[key] = this.#attributes[key];
      }
    }
    return dirty;
  }

  public isDirty(key?: keyof TAttributes): boolean {
    return key === undefined ? Object.keys(this.dirty).length > 0 : key in this.dirty;
  }

  public events(): readonly DomainEvent[] {
    return [...this.#events];
  }

  public serialize(): ModelSnapshot<TId, TAttributes> {
    return { id: this.#id, attributes: this.attributes, version: this.#version };
  }

  protected get<TKey extends keyof TAttributes>(key: TKey): TAttributes[TKey] {
    return this.#attributes[key];
  }

  protected set(patch: Partial<TAttributes>): void {
    this.#attributes = { ...this.#attributes, ...structuredClone(patch) };
  }

  protected record(event: DomainEvent): void {
    if (event.aggregateId !== String(this.#id)) {
      throw new Error('Domain event aggregate id does not match model id');
    }
    this.#events.push(event);
  }

  public markPersisted(version: number): void {
    this.#version = version;
    this.#persisted = true;
    this.#deleted = false;
    this.#original = structuredClone(this.#attributes);
    this.#events = [];
  }

  public markDeleted(version: number): void {
    this.#version = version;
    this.#persisted = true;
    this.#deleted = true;
    this.#original = structuredClone(this.#attributes);
    this.#events = [];
  }

  public markRestored(version: number): void {
    this.markPersisted(version);
  }
}
