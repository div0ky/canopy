import { CurrentExecution, SignalHandler } from '@doxajs/core'

import { CounterTouched } from '../signals/counter-touched.js'
import { CounterEventRecorder } from '../support/counter-event-recorder.js'

export class RecordCounterTouched extends SignalHandler<CounterTouched> {
  static id = 'record-counter-touched'
  static override readonly access = 'public'

  private readonly recorder = this.inject(CounterEventRecorder)
  private readonly execution = this.inject(CurrentExecution)

  handle(signal: CounterTouched): void {
    this.recorder.record({
      event: `counter-touched:${signal.payload.counterId}`,
      phase: 'signal',
      correlationId: signal.correlationId(),
      actor: this.execution.context.actor.kind,
    })
  }
}
