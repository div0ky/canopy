import { Event } from '@doxajs/core'

export class CounterIncremented extends Event<{
  counterId: string
  amount: number
  value: number
}> {
  static override readonly id = 'counter-incremented'
}
