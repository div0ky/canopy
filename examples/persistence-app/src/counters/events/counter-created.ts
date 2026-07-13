import { DomainEvent } from '@doxajs/core'

import { Counter } from '../models/counter.js'

export class CounterCreated extends DomainEvent<{ value: number }> {
  static override readonly id = 'counter-created'
  static override readonly model = Counter
}
