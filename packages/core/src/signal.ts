import { currentSignalDispatcher } from './signal-context.js'
import { DoxaRole } from './role.js'

export class SignalDispatchError extends Error {
  override readonly name = 'SignalDispatchError'
}

/** Immediate, in-process coordination. Signals are never journaled, queued, or deferred. */
export abstract class Signal<Payload = never> extends DoxaRole {
  static readonly id: string = ''
  readonly payload: Payload

  constructor(...payload: [Payload] extends [never] ? [] : [payload: Payload]) {
    super()
    this.payload = payload[0] as Payload
  }

  static dispatch<Arguments extends readonly unknown[], Instance extends Signal<unknown>>(
    this: new (...arguments_: Arguments) => Instance,
    ...arguments_: Arguments
  ): Promise<void> {
    const dispatcher = currentSignalDispatcher()
    if (!dispatcher) {
      throw new SignalDispatchError('Signal dispatch requires an active Doxa-managed execution.')
    }
    return dispatcher.dispatch(new this(...arguments_))
  }
}

export abstract class SignalHandler<
  Instance extends Signal<unknown> = Signal<unknown>,
> extends DoxaRole {
  static readonly access: string = ''
  abstract handle(signal: Instance): void | Promise<void>
}
