import { CurrentExecution, Listener } from '@canopy/core'

import { HttpPinged } from '../events/http-pinged.js'
import { SystemEventRecorder } from '../support/system-event-recorder.js'

export class RecordHttpPinged extends Listener<HttpPinged> {
  static id = 'record-http-pinged'
  static override readonly access = 'public'

  private readonly recorder = this.inject(SystemEventRecorder)
  private readonly execution = this.inject(CurrentExecution)

  handle(_event: HttpPinged): void {
    this.recorder.record({
      event: 'http-pinged',
      phase: 'http',
      correlationId: this.execution.context.correlationId,
      actor: this.execution.context.actor.kind,
    })
  }
}
