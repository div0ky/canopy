import { Query } from '@canopy/core'

import { ExecutionCounter } from './execution-counter.js'

export class MutateCounterQuery extends Query<number, number> {
  static id = 'mutate-counter'
  static override readonly access = 'public'

  private readonly counter = this.inject(ExecutionCounter)

  handle(amount: number): number {
    return this.counter.increment(amount)
  }
}
