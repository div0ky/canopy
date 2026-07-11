import { Action } from '@doxajs/core'

import { Counter } from '../models/counter.js'

export class InspectCounter extends Action<string, Record<string, unknown>> {
  static id = 'inspect-counter'
  static override readonly access = 'public'

  async handle(id: string): Promise<Record<string, unknown>> {
    const first = await Counter.findOrFail(id)
    const second = await Counter.find(id)
    const cleanSave = await first.save()
    return {
      sameInstance: first === second,
      cleanSave,
      exists: first.exists,
      version: first.version,
      dirty: first.isDirty(),
      clean: first.isClean(),
      changed: first.wasChanged(),
      original: first.getOriginal(),
      changes: first.getChanges(),
      recentlyCreated: first.wasRecentlyCreated,
    }
  }
}
