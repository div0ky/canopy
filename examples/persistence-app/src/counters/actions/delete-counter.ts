import { Action } from '@canopy/core'

import { Counter } from '../models/counter.js'

export class DeleteCounter extends Action<string, void> {
  static id = 'delete-counter'
  static override readonly access = 'public'

  async handle(id: string): Promise<void> {
    const counter = await Counter.findOrFail(id)
    counter.markForDeletion()
    await counter.delete()
  }
}
