import { CurrentExecution, Listener } from '@canopy/core'

import { CounterIncremented } from '../events/counter-incremented.js'
import { CounterEventRecorder } from '../support/counter-event-recorder.js'

export class RecordCounterIncremented extends Listener<CounterIncremented> {
  static id = 'record-counter-incremented'
  static override readonly access = 'public'

  constructor(
    private readonly recorder: CounterEventRecorder,
    private readonly execution: CurrentExecution,
  ) {
    super()
  }

  handle(event: CounterIncremented): void {
    if (event.amount === 13) throw new Error('Unlucky counter increments are rejected locally.')
    this.recorder.record({
      event: 'counter-incremented',
      phase: 'local',
      correlationId: this.execution.context.correlationId,
      actor: this.execution.context.actor.kind,
      value: event.value,
    })
  }
}
