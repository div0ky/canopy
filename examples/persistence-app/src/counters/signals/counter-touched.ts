import { Signal } from '@doxajs/core'

export class CounterTouched extends Signal<{ counterId: string }> {
  static override readonly id = 'counter-touched'
}
