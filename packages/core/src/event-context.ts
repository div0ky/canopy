import { AsyncLocalStorage } from 'node:async_hooks'

import type { Event } from './event.js'

export interface EventDispatcher {
  dispatch(event: Event<unknown>): Promise<void>
}

const storage = new AsyncLocalStorage<EventDispatcher>()

export function currentEventDispatcher(): EventDispatcher | undefined {
  return storage.getStore()
}

export function runWithEventDispatcher<Output>(
  dispatcher: EventDispatcher,
  work: () => Output,
): Output {
  return storage.run(dispatcher, work)
}
