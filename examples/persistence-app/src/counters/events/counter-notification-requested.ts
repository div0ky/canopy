import { Event } from '@canopy/core'

export class CounterNotificationRequested extends Event<{ counterId: string }> {
  static override readonly id = 'counter-notification-requested'
}
