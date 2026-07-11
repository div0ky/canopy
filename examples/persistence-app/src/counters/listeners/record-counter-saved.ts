import { CurrentExecution, Listener } from '@canopy/core'

import { CounterSaved } from '../events/counter-saved.js'
import { CounterEventRecorder } from '../support/counter-event-recorder.js'

export class RecordCounterSaved extends Listener<CounterSaved> {
  static id = 'record-counter-saved'
  static override readonly access = 'public'

  constructor(
    private readonly recorder: CounterEventRecorder,
    private readonly execution: CurrentExecution,
  ) {
    super()
  }

  handle(event: CounterSaved): void {
    this.recorder.record({
      event: 'counter-saved',
      phase: 'after-commit',
      correlationId: this.execution.context.correlationId,
      actor: this.execution.context.actor.kind,
      value: event.value,
    })
  }
}
