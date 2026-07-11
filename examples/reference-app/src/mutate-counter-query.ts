import { Query } from '@canopy/core'

import { ExecutionCounter } from './execution-counter.js'

export class MutateCounterQuery extends Query<number, number> {
  static id = 'mutate-counter'
  static override readonly access = 'public'

  constructor(private readonly counter: ExecutionCounter) {
    super()
  }

  handle(amount: number): number {
    return this.counter.increment(amount)
  }
}
