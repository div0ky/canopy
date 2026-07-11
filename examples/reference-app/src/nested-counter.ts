import { Action, ActionBus } from '@canopy/core'

import { IncrementCounter } from './increment-counter.js'

export class NestedCounter extends Action<number, number> {
  static id = 'nested-counter'
  static override readonly access = 'public'

  private readonly actions = this.inject(ActionBus)

  handle(amount: number): Promise<number> {
    return this.actions.execute(IncrementCounter, { amount })
  }
}
