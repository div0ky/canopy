import { Signal } from '@canopy/core'

export class CounterTouched extends Signal<{ counterId: string }> {
  static override readonly id = 'counter-touched'
}
