import { Action } from '@doxajs/core'

import { Counter } from '../models/counter.js'

export class SaveDetachedCounter extends Action<string, void> {
  static id = 'save-detached-counter'
  static override readonly access = 'public'

  async handle(id: string): Promise<void> {
    const counter = new Counter({ id, value: 1 })
    await counter.save()
  }
}
