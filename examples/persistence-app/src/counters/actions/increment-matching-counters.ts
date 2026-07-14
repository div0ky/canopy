import { Action } from '@doxajs/core'

import { Counter } from '../models/counter.js'

export class IncrementMatchingCounters extends Action<string, readonly string[]> {
  static id = 'increment-matching-counters'
  static override readonly access = 'public'

  async handle(label: string): Promise<readonly string[]> {
    const counters = await Counter.where({ label }).orderBy('id').get()
    for (const counter of counters) {
      counter.increment(1)
      await counter.save()
    }
    return counters.map((counter) => counter.id)
  }
}
