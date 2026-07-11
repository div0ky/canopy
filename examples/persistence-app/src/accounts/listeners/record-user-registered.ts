import { CurrentExecution, Listener } from '@doxajs/core'

import { UserRegistered } from '../events/user-registered.js'
import { AccountEventRecorder } from '../support/account-event-recorder.js'

export class RecordUserRegistered extends Listener<UserRegistered> {
  static readonly id = 'record-user-registered'
  static override readonly access = 'public'

  private readonly recorder = this.inject(AccountEventRecorder)
  private readonly execution = this.inject(CurrentExecution)

  handle(_event: UserRegistered): void {
    this.recorder.record({
      event: 'user-registered',
      phase: 'http',
      correlationId: this.execution.context.correlationId,
      actor: this.execution.context.actor.kind,
    })
  }
}
