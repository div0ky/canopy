import { AsyncLocalStorage } from 'node:async_hooks'

import type {
  Job,
  JobConstructor,
  JobDispatchOptions,
} from './queue.js'
export interface JobDispatcher {
  dispatch<Input, Instance extends Job<Input>>(
    Constructor: JobConstructor<Instance, Input>,
    input: Input,
    options?: JobDispatchOptions,
  ): Promise<string>
}

const storage = new AsyncLocalStorage<JobDispatcher>()

export function currentJobDispatcher(): JobDispatcher | undefined {
  return storage.getStore()
}

export function runWithJobDispatcher<Output>(
  dispatcher: JobDispatcher,
  work: () => Output,
): Output {
  return storage.run(dispatcher, work)
}
