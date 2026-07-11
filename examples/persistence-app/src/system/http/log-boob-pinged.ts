import { CurrentExecution, Listener, type ShouldHandleEventsAfterCommit } from '@doxajs/core'
import type { BoobPinged } from './boob.event.js'

export class BoobPingDoThingListener
  extends Listener<BoobPinged>
  implements ShouldHandleEventsAfterCommit
{
  static id = 'boob-ping-do-thing-log'
  static override readonly access = 'public'

  private readonly execution = this.inject(CurrentExecution)

  handle(event: BoobPinged): void {
    this.logger.warn('I did a thing!!!', {
      correlationId: this.execution.context.correlationId,
      event: event.constructor.name,
    })
  }
}
