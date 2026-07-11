import { Action } from '@canopy/core'

import { CounterTouched } from '../signals/counter-touched.js'

export interface DispatchCounterSignalInput {
  readonly counterId: string
  readonly failAfterDispatch?: boolean
}

export class DispatchCounterSignal extends Action<DispatchCounterSignalInput, void> {
  static id = 'dispatch-counter-signal'
  static override readonly access = 'public'

  async handle(input: DispatchCounterSignalInput): Promise<void> {
    await CounterTouched.dispatch({ counterId: input.counterId })
    if (input.failAfterDispatch) throw new Error('failed after signal dispatch')
  }
}
