import { Signal } from '@canopy/core'

export class CounterTouched extends Signal {
  static override readonly id = 'counter-touched'

  constructor(readonly counterId: string) {
    super()
  }
}
