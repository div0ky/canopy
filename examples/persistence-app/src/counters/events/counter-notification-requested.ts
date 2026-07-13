import { CurrentExecution, Event } from '@doxajs/core'

export class CounterNotificationRequested extends Event<{ counterId: string }> {
  static override readonly id = 'counter-notification-requested'

  private readonly execution = this.inject(CurrentExecution)

  executionId(): string {
    return this.execution.context.executionId
  }
}
