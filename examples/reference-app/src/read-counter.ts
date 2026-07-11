import { Query } from '@canopy/core'

import { ExecutionCounter } from './execution-counter.js'

export class ReadCounter extends Query<void, number> {
  static id = 'read-counter'
  static override readonly access = 'public'

  constructor(private readonly counter: ExecutionCounter) {
    super()
  }

  handle(_input: void): number {
    return this.counter.value
  }
}
