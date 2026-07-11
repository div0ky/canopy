import { Query } from '@doxajs/core'

import { ExecutionCounter } from './execution-counter.js'

export class ReadCounter extends Query<void, number> {
  static id = 'read-counter'
  static override readonly access = 'public'

  private readonly counter = this.inject(ExecutionCounter)

  handle(_input: void): number {
    return this.counter.value
  }
}
