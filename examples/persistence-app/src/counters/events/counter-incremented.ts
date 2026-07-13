import { CurrentExecution, Event } from '@doxajs/core'

export class CounterIncremented extends Event<{
  counterId: string
  amount: number
  value: number
}> {
  static override readonly id = 'counter-incremented'

  private readonly execution = this.inject(CurrentExecution)

  correlationId(): string {
    return this.execution.context.correlationId
  }
}
