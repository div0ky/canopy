import { Action } from '@canopy/core'

import { Counter } from '../models/counter.js'

export class CreateCounter extends Action<{ id: string; value: number }, Record<string, unknown>> {
  static id = 'create-counter'
  static override readonly access = 'public'

  async handle(input: { id: string; value: number }): Promise<Record<string, unknown>> {
    const counter = await Counter.create(input)
    return {
      id: counter.id,
      value: counter.value,
      version: counter.version,
      exists: counter.exists,
      recentlyCreated: counter.wasRecentlyCreated,
      changes: counter.getChanges(),
    }
  }
}
