import { CurrentExecution, CurrentJob, Listener, type ShouldQueue } from '@doxajs/core'

import { CounterNotificationRequested } from '../events/counter-notification-requested.js'
import { CounterEventRecorder } from '../support/counter-event-recorder.js'

export class RecordCounterNotification
  extends Listener<CounterNotificationRequested>
  implements ShouldQueue
{
  static id = 'record-counter-notification'
  static override readonly access = 'public'

  private readonly recorder = this.inject(CounterEventRecorder)
  private readonly execution = this.inject(CurrentExecution)
  private readonly job = this.inject(CurrentJob)

  handle(_event: CounterNotificationRequested): void {
    this.recorder.record({
      event: 'counter-notification-requested',
      phase: 'queued',
      correlationId: this.execution.context.correlationId,
      actor: this.execution.context.actor.kind,
      jobId: this.job.context.id,
      attempt: this.job.context.attempt,
      executionId: this.execution.context.executionId,
    })
  }
}
