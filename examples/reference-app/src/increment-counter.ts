import { Action } from '@doxajs/core'

import { ExecutionCounter } from './execution-counter.js'
import { OptionalCounterAudit } from './optional-counter-audit.js'

export interface IncrementCounterInput {
  readonly amount: number
  readonly delay?: number
}

export class IncrementCounter extends Action<IncrementCounterInput, number> {
  static id = 'increment-counter'
  static override readonly access = 'public'

  private readonly counter = this.inject(ExecutionCounter)
  private readonly audit = this.inject.optional(OptionalCounterAudit)

  async handle(input: IncrementCounterInput): Promise<number> {
    if (input.delay) {
      await new Promise((resolve) => setTimeout(resolve, input.delay))
    }
    const value = this.counter.increment(input.amount)
    this.audit?.record(input.amount)
    return value
  }
}
