import { CurrentExecution, Listener } from '@canopy/core'

import { UserLoggedIn } from '../events/user-logged-in.js'
import { AccountEventRecorder } from '../support/account-event-recorder.js'

export class RecordUserLoggedIn extends Listener<UserLoggedIn> {
  static readonly id = 'record-user-logged-in'
  static override readonly access = 'public'

  constructor(
    private readonly recorder: AccountEventRecorder,
    private readonly execution: CurrentExecution,
  ) {
    super()
  }

  handle(_event: UserLoggedIn): void {
    this.recorder.record({
      event: 'user-logged-in',
      phase: 'http',
      correlationId: this.execution.context.correlationId,
      actor: this.execution.context.actor.kind,
    })
  }
}
