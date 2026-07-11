import { Event, type ShouldDispatchAfterCommit } from '@doxajs/core'

export class CounterSaved
  extends Event<{ counterId: string; value: number }>
  implements ShouldDispatchAfterCommit
{
  static override readonly id = 'counter-saved'
}
