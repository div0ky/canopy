import { Action, type ModelQuery } from '@doxajs/core'

import { Counter, type CounterAttributes, type CounterRelations } from '../models/counter.js'

export let capturedCounter: Counter | undefined
export let capturedCounterQuery:
  ModelQuery<Counter, CounterAttributes, CounterRelations> | undefined

export function resetCapturedCounter(): void {
  capturedCounter = undefined
  capturedCounterQuery = undefined
}

export class CaptureCounter extends Action<string, void> {
  static id = 'capture-counter'
  static override readonly access = 'public'

  async handle(id: string): Promise<void> {
    const query = Counter.query()
    capturedCounterQuery = query
    capturedCounter = await query.findOrFail(id)
  }
}
