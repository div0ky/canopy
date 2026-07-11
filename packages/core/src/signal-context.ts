import { AsyncLocalStorage } from 'node:async_hooks'

import type { Signal } from './signal.js'

export interface SignalDispatcher {
  dispatch(signal: Signal<unknown>): Promise<void>
}

const dispatchers = new AsyncLocalStorage<SignalDispatcher>()

export function currentSignalDispatcher(): SignalDispatcher | undefined {
  return dispatchers.getStore()
}

export function runWithSignalDispatcher<Output>(
  dispatcher: SignalDispatcher,
  work: () => Output | Promise<Output>,
): Output | Promise<Output> {
  return dispatchers.run(dispatcher, work)
}
