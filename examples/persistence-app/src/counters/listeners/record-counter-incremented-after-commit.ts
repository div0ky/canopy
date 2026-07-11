import {
  CurrentExecution,
  Listener,
  type ShouldHandleEventsAfterCommit,
} from '@canopy/core'

import { CounterIncremented } from '../events/counter-incremented.js'
import { CounterEventRecorder } from '../support/counter-event-recorder.js'

export class RecordCounterIncrementedAfterCommit
  extends Listener<CounterIncremented>
  implements ShouldHandleEventsAfterCommit
{
  static id = 'record-counter-incremented-after-commit'
  static override readonly access = 'public'

  constructor(
    private readonly recorder: CounterEventRecorder,
    private readonly execution: CurrentExecution,
  ) {
    super()
  }

  handle(event: CounterIncremented): void {
    if (event.amount === 7) throw new Error('After-commit counter processing failed.')
    this.recorder.record({
      event: 'counter-incremented',
      phase: 'after-commit',
      correlationId: this.execution.context.correlationId,
      actor: this.execution.context.actor.kind,
      value: event.value,
    })
  }
}
