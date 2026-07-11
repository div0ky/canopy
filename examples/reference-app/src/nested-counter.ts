import { Action, ActionBus } from '@canopy/core'

import { IncrementCounter } from './increment-counter.js'

export class NestedCounter extends Action<number, number> {
  static id = 'nested-counter'
  static override readonly access = 'public'

  constructor(private readonly actions: ActionBus) {
    super()
  }

  handle(amount: number): Promise<number> {
    return this.actions.execute(IncrementCounter, { amount })
  }
}
