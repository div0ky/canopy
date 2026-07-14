import { Action, type ModelChanges } from '@doxajs/core'

import { Counter, type CounterAttributes } from '../models/counter.js'

export interface RenameCounterInput {
  readonly id: string
  readonly label?: string
}

export interface RenameCounterResult {
  readonly label: string | undefined
  readonly changes: ModelChanges<CounterAttributes>
}

export class RenameCounter extends Action<RenameCounterInput, RenameCounterResult> {
  static id = 'rename-counter'
  static override readonly access = 'public'

  async handle(input: RenameCounterInput): Promise<RenameCounterResult> {
    const counter = await Counter.findOrFail(input.id)
    counter.fill({ label: input.label })
    await counter.save()
    return {
      label: counter.label,
      changes: counter.getChanges(),
    }
  }
}
