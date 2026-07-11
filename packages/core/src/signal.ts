import { currentSignalDispatcher } from './signal-context.js'

export class SignalDispatchError extends Error {
  override readonly name = 'SignalDispatchError'
}

/** Immediate, in-process coordination. Signals are never journaled, queued, or deferred. */
export abstract class Signal {
  static readonly id: string = ''

  static dispatch<Arguments extends readonly unknown[], Instance extends Signal>(
    this: new (...arguments_: Arguments) => Instance,
    ...arguments_: Arguments
  ): Promise<void> {
    const dispatcher = currentSignalDispatcher()
    if (!dispatcher) {
      throw new SignalDispatchError('Signal dispatch requires an active Canopy-managed execution.')
    }
    return dispatcher.dispatch(new this(...arguments_))
  }
}

export abstract class SignalHandler<Instance extends Signal = Signal> {
  static readonly access: string = ''
  abstract handle(signal: Instance): void | Promise<void>
}
