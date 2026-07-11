import { Action } from '@canopy/core'

import { CounterNotificationRequested } from '../events/counter-notification-requested.js'

export class RequestCounterNotification extends Action<string, void> {
  static id = 'request-counter-notification'
  static override readonly access = 'public'

  async handle(counterId: string): Promise<void> {
    await CounterNotificationRequested.dispatch({ counterId })
  }
}
