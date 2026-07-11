import { CurrentExecution, SignalHandler } from '@canopy/core'

import { CounterTouched } from '../signals/counter-touched.js'
import { CounterEventRecorder } from '../support/counter-event-recorder.js'

export class RecordCounterTouched extends SignalHandler<CounterTouched> {
  static id = 'record-counter-touched'
  static override readonly access = 'public'

  constructor(
    private readonly recorder: CounterEventRecorder,
    private readonly execution: CurrentExecution,
  ) {
    super()
  }

  handle(signal: CounterTouched): void {
    this.recorder.record({
      event: `counter-touched:${signal.counterId}`,
      phase: 'signal',
      correlationId: this.execution.context.correlationId,
      actor: this.execution.context.actor.kind,
    })
  }
}
