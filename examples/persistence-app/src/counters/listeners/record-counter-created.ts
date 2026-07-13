import { CurrentExecution, Listener, type ShouldQueue } from '@doxajs/core'

import { CounterCreated } from '../events/counter-created.js'
import { CounterEventRecorder } from '../support/counter-event-recorder.js'

export class RecordCounterCreated extends Listener<CounterCreated> implements ShouldQueue {
  static readonly id = 'record-counter-created'
  static override readonly access = 'public'

  private readonly recorder = this.inject(CounterEventRecorder)
  private readonly execution = this.inject(CurrentExecution)

  handle(event: CounterCreated): void {
    this.recorder.record({
      event: `counter-created:${event.entityId}`,
      phase: 'domain',
      correlationId: this.execution.context.correlationId,
      actor: this.execution.context.actor.kind,
      value: event.payload.value,
    })
  }
}
