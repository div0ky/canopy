import { Action } from '@canopy/core'

import { ProcessCounterJob, type ProcessCounterInput } from '../jobs/process-counter.job.js'

export interface DispatchProcessCounterInput extends ProcessCounterInput {
  readonly delaySeconds?: number
  readonly idempotencyKey?: string
  readonly failAfterDispatch?: boolean
}

export class DispatchProcessCounter extends Action<DispatchProcessCounterInput, string> {
  static id = 'dispatch-process-counter'
  static override readonly access = 'public'

  async handle(input: DispatchProcessCounterInput): Promise<string> {
    const id = await ProcessCounterJob.dispatch(
      {
        key: input.key,
        ...(input.failUntilAttempt === undefined
          ? {}
          : { failUntilAttempt: input.failUntilAttempt }),
        ...(input.holdMilliseconds === undefined
          ? {}
          : { holdMilliseconds: input.holdMilliseconds }),
        ...(input.counterId ? { counterId: input.counterId } : {}),
      },
      {
        ...(input.delaySeconds === undefined ? {} : { delaySeconds: input.delaySeconds }),
        ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
      },
    )
    if (input.failAfterDispatch) throw new Error('Counter job dispatch rolled back.')
    return id
  }
}
