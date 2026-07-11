import { Action } from '@canopy/core'

import { Counter } from '../models/counter.js'

export let capturedCounter: Counter | undefined

export function resetCapturedCounter(): void {
  capturedCounter = undefined
}

export class CaptureCounter extends Action<string, void> {
  static id = 'capture-counter'
  static override readonly access = 'public'

  async handle(id: string): Promise<void> {
    capturedCounter = await Counter.findOrFail(id)
  }
}
