import { Action } from '@canopy/core'

import { ExecutionCounter } from './execution-counter.js'

export interface IncrementCounterInput {
  readonly amount: number
  readonly delay?: number
}

export class IncrementCounter extends Action<IncrementCounterInput, number> {
  static id = 'increment-counter'
  static override readonly access = 'public'

  constructor(private readonly counter: ExecutionCounter) {
    super()
  }

  async handle(input: IncrementCounterInput): Promise<number> {
    if (input.delay) {
      await new Promise((resolve) => setTimeout(resolve, input.delay))
    }
    return this.counter.increment(input.amount)
  }
}
