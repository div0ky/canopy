import { Action } from '@canopy/core'

import { ExecutionCounter } from './execution-counter.js'

export class FailCounter extends Action<number, never> {
  static id = 'fail-counter'
  static override readonly access = 'public'

  constructor(private readonly counter: ExecutionCounter) {
    super()
  }

  handle(amount: number): never {
    this.counter.increment(amount)
    throw new Error('Counter action failed.')
  }
}
