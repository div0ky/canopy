import { CurrentExecution, Signal } from '@doxajs/core'

export class CounterTouched extends Signal<{ counterId: string }> {
  static override readonly id = 'counter-touched'

  private readonly execution = this.inject(CurrentExecution)

  correlationId(): string {
    return this.execution.context.correlationId
  }
}
