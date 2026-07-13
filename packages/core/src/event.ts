import { currentEventDispatcher } from './event-context.js'
import { DoxaRole } from './role.js'
import type { Model } from './model.js'

export class EventDispatchError extends Error {
  override readonly name = 'EventDispatchError'
}

export abstract class Event<Payload = never> extends DoxaRole {
  static readonly id: string = ''
  static readonly version: number = 1
  readonly payload: Payload

  constructor(...payload: [Payload] extends [never] ? [] : [payload: Payload]) {
    super()
    this.payload = payload[0] as Payload
  }

  static dispatch<Arguments extends readonly unknown[], Instance extends Event<unknown>>(
    this: new (...arguments_: Arguments) => Instance,
    ...arguments_: Arguments
  ): Promise<void> {
    const dispatcher = currentEventDispatcher()
    if (!dispatcher) {
      throw new EventDispatchError('Event dispatch requires an active Doxa-managed execution.')
    }
    return dispatcher.dispatch(new this(...arguments_))
  }
}

/** A typed domain fact journaled atomically through the active Unit of Work. */
export abstract class DomainEvent<Payload = never> extends Event<Payload> {
  declare static readonly model: {
    new (...arguments_: never[]): Model
    readonly id: string
  }
  readonly entityId: string

  constructor(entityId: string, ...payload: [Payload] extends [never] ? [] : [payload: Payload]) {
    super(...payload)
    if (entityId.trim().length === 0) throw new TypeError('DomainEvent entityId must not be empty.')
    this.entityId = entityId
  }
}

export abstract class Listener<Instance extends Event<unknown> = Event<unknown>> extends DoxaRole {
  static readonly access: string = ''
  abstract handle(event: Instance): void | Promise<void>
}

/** Delays the entire event until the active transaction commits. */
export interface ShouldDispatchAfterCommit {}

/** Delays this local listener until the active transaction commits. */
export interface ShouldHandleEventsAfterCommit {}

/** Reserved Laravel-aligned capability; queue execution arrives with the queue slice. */
export interface ShouldQueue {}

/** Reserved Laravel-aligned capability; queue execution arrives with the queue slice. */
export interface ShouldQueueAfterCommit extends ShouldQueue {}
