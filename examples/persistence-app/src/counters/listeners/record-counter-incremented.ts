import { CurrentExecution, Listener } from '@doxajs/core'

import { CounterIncremented } from '../events/counter-incremented.js'
import { CounterEventRecorder } from '../support/counter-event-recorder.js'

export class RecordCounterIncremented extends Listener<CounterIncremented> {
  static id = 'record-counter-incremented'
  static override readonly access = 'public'

  private readonly recorder = this.inject(CounterEventRecorder)
  private readonly execution = this.inject(CurrentExecution)

  handle(event: CounterIncremented): void {
    if (event.payload.amount === 13)
      throw new Error('Unlucky counter increments are rejected locally.')
    this.recorder.record({
      event: 'counter-incremented',
      phase: 'local',
      correlationId: event.correlationId(),
      actor: this.execution.context.actor.kind,
      value: event.payload.value,
    })
  }
}
