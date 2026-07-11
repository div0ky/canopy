import { Event } from '@canopy/core'

export class CounterNotificationRequested extends Event {
  static override readonly id = 'counter-notification-requested'

  constructor(readonly counterId: string) {
    super()
  }
}
