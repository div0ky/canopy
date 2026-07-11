import { currentEventDispatcher } from './event-context.js'

export class EventDispatchError extends Error {
  override readonly name = 'EventDispatchError'
}

export abstract class Event {
  static readonly id: string = ''

  static dispatch<Arguments extends readonly unknown[], Instance extends Event>(
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

export abstract class Listener<Instance extends Event = Event> {
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
