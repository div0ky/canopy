import { Action } from '@doxajs/core'

import { CounterBroadcasted } from '../events/counter-broadcasted.js'

export class BroadcastCounter extends Action<{ counterId: string; value: number; fail?: boolean }> {
  static readonly id = 'broadcast-counter'
  static override readonly access = 'public'

  async handle(input: { counterId: string; value: number; fail?: boolean }): Promise<void> {
    await CounterBroadcasted.dispatch({ counterId: input.counterId, value: input.value })
    if (input.fail) throw new Error('Broadcast transaction rolled back.')
  }
}
