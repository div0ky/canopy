import { randomUUID } from 'node:crypto'

import { Action, Authorization, CurrentExecution, Mailer, Sms } from '@doxajs/core'

import { CounterNotificationRequested } from '../events/counter-notification-requested.js'
import { ProcessCounterJob } from '../jobs/process-counter.job.js'
import { Counter } from '../models/counter.js'
import { CounterTouched } from '../signals/counter-touched.js'

export interface SecureIncrementCounterInput {
  readonly id: string
  readonly amount: number
}

export class SecureIncrementCounter extends Action<
  SecureIncrementCounterInput,
  { id: string; value: number; version: number; jobId: string }
> {
  static id = 'secure-increment-counter'
  static override readonly access = 'counters.write'

  private readonly authorization = this.inject(Authorization)
  private readonly execution = this.inject(CurrentExecution)
  private readonly mailer = this.inject(Mailer)
  private readonly sms = this.inject(Sms)

  async handle(
    input: SecureIncrementCounterInput,
  ): Promise<{ id: string; value: number; version: number; jobId: string }> {
    const ownerId = this.execution.context.actor.id!
    await this.authorization.authorize('counters.update', { ownerId })
    const counter = (await Counter.find(input.id)) ?? Counter.make({ id: input.id, value: 0 })
    counter.increment(input.amount)
    await counter.dispatchIncremented(input.amount)
    await CounterTouched.dispatch({ counterId: counter.id })
    await CounterNotificationRequested.dispatch({ counterId: counter.id })
    const jobId = await ProcessCounterJob.dispatch(
      { key: `secure:${counter.id}`, counterId: counter.id },
      { idempotencyKey: `secure:${counter.id}:${counter.value}` },
    )
    await this.mailer.send({
      id: randomUUID(),
      from: 'doxa@example.test',
      to: [`${ownerId}@example.test`],
      subject: 'Counter updated',
      text: `${counter.id}=${counter.value}`,
    })
    await this.sms.send({
      id: randomUUID(),
      to: '+15555550123',
      text: `${counter.id}=${counter.value}`,
    })
    await counter.save()
    return { id: counter.id, value: counter.value, version: counter.version!, jobId }
  }
}
