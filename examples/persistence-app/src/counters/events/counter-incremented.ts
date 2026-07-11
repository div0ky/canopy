import { Event } from '@canopy/core'

export class CounterIncremented extends Event {
  static override readonly id = 'counter-incremented'

  constructor(
    readonly counterId: string,
    readonly amount: number,
    readonly value: number,
  ) {
    super()
  }
}
