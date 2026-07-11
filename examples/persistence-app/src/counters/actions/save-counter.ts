import { Action } from '@canopy/core'

import { Counter } from '../models/counter.js'

export interface SaveCounterInput {
  readonly id: string
  readonly amount: number
  readonly failAfterWrites?: boolean
  readonly delayAfterLoad?: number
}

export interface SaveCounterResult {
  readonly id: string
  readonly value: number
  readonly version: number
  readonly originalValue: number | undefined
  readonly changes: Record<string, unknown>
  readonly dirtyBeforeSave: boolean
  readonly cleanAfterSave: boolean
  readonly wasChanged: boolean
  readonly exists: boolean
  readonly recentlyCreated: boolean
}

export class SaveCounter extends Action<SaveCounterInput, SaveCounterResult> {
  static id = 'save-counter'
  static override readonly access = 'public'

  async handle(input: SaveCounterInput): Promise<SaveCounterResult> {
    const counter = (await Counter.find(input.id)) ?? Counter.make({ id: input.id, value: 0 })
    const originalValue = counter.getOriginal('value')
    if (input.delayAfterLoad) {
      await new Promise((resolve) => setTimeout(resolve, input.delayAfterLoad))
    }
    counter.increment(input.amount)
    await counter.dispatchIncremented(input.amount)
    const dirtyBeforeSave = counter.isDirty()
    await counter.save()

    if (input.failAfterWrites) throw new Error('Counter action failed after persistence writes.')
    return {
      id: counter.id,
      value: counter.value,
      version: counter.version!,
      originalValue,
      changes: counter.getChanges(),
      dirtyBeforeSave,
      cleanAfterSave: counter.isClean(),
      wasChanged: counter.wasChanged(),
      exists: counter.exists,
      recentlyCreated: counter.wasRecentlyCreated,
    }
  }
}
