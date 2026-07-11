import {
  Event,
  type ShouldDispatchAfterCommit,
} from '@canopy/core'

export class CounterSaved extends Event implements ShouldDispatchAfterCommit {
  static override readonly id = 'counter-saved'

  constructor(
    readonly counterId: string,
    readonly value: number,
  ) {
    super()
  }
}
