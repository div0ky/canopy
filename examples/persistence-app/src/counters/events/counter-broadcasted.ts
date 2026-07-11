import { Event, PresenceChannel, PrivateChannel, type ShouldBroadcast } from '@doxajs/core'

export class CounterBroadcasted
  extends Event<{ counterId: string; value: number }>
  implements ShouldBroadcast
{
  static override readonly id = 'counter-broadcasted'

  broadcastOn() {
    return [
      new PrivateChannel(`counters.${this.payload.counterId}`),
      new PresenceChannel('counters.online'),
    ]
  }

  broadcastAs(): string {
    return 'counter.updated'
  }
}
