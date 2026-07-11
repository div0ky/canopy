import { Action } from '@doxajs/core'

import { Counter } from '../models/counter.js'

export class RefreshCounter extends Action<string, Record<string, unknown>> {
  static id = 'refresh-counter'
  static override readonly access = 'public'

  async handle(id: string): Promise<Record<string, unknown>> {
    const counter = await Counter.findOrFail(id)
    counter.increment(10)
    const dirtyBefore = counter.isDirty()
    await counter.refresh()
    return {
      value: counter.value,
      dirtyBefore,
      cleanAfter: counter.isClean(),
      original: counter.getOriginal(),
    }
  }
}
