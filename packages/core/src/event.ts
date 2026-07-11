import { currentEventDispatcher } from './event-context.js'
import { CanopyRole } from './role.js'

export class EventDispatchError extends Error {
  override readonly name = 'EventDispatchError'
}

export abstract class Event<Payload = never> extends CanopyRole {
  static readonly id: string = ''
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
      throw new EventDispatchError(
        'Event dispatch requires an active Canopy-managed execution.',
      )
    }
    return dispatcher.dispatch(new this(...arguments_))
  }
}

export abstract class Listener<Instance extends Event<unknown> = Event<unknown>> extends CanopyRole {
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
