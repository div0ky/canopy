import { Action } from '@doxajs/core'

import { ExecutionCounter } from './execution-counter.js'

export class FailCounter extends Action<number, never> {
  static id = 'fail-counter'
  static override readonly access = 'public'

  private readonly counter = this.inject(ExecutionCounter)

  handle(amount: number): never {
    this.counter.increment(amount)
    throw new Error('Counter action failed.')
  }
}
