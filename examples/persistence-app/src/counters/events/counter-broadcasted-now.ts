import { Channel, Event, type ShouldBroadcastNow } from '@doxajs/core'

export class CounterBroadcastedNow
  extends Event<{ counterId: string }>
  implements ShouldBroadcastNow
{
  static override readonly id = 'counter-broadcasted-now'

  broadcastOn() {
    return new Channel('counters.public')
  }

  broadcastWith() {
    return { id: this.payload.counterId }
  }
}
